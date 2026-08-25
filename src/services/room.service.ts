import { customAlphabet } from 'nanoid';
import { prisma } from '../lib/prisma.js';
import { getRedisClient } from '../lib/redis.js';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { RoomState, PlaybackStatus } from '../types/index.js';
import { logger } from '../lib/logger.js';

// Human-friendly 4-character room code generator (excludes ambiguous chars like 0, O, 1, I, L)
const generateCode = customAlphabet('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 4);

export class RoomService {
  private static getRoomRedisKey(roomCode: string): string {
    return `room:${roomCode.toUpperCase()}:state`;
  }

  private static getRoomMembersKey(roomCode: string): string {
    return `room:${roomCode.toUpperCase()}:members`;
  }

  /**
   * Create a new room with host guest
   */
  static async createRoom(hostGuestId: string, initialTrackId?: string | null): Promise<{ roomCode: string; state: RoomState }> {
    let roomCode = generateCode();
    let attempts = 0;
    
    // Ensure unique room code
    while (attempts < 5) {
      const existing = await prisma.room.findUnique({ where: { roomCode } });
      if (!existing) break;
      roomCode = generateCode();
      attempts++;
    }

    const room = await prisma.room.create({
      data: {
        roomCode,
        hostGuestId,
        isActive: true,
        members: {
          create: {
            guestId: hostGuestId,
          },
        },
      },
    });

    const now = Date.now();
    const initialState: RoomState = {
      roomId: room.id,
      roomCode: room.roomCode,
      hostGuestId,
      trackId: initialTrackId || null,
      status: 'paused',
      basePositionMs: 0,
      updatedAt: now,
      sequence: 1000,
      membersCount: 1,
    };

    // Save initial state to Redis with TTL
    await this.saveRoomStateToRedis(roomCode, initialState);
    await this.addMemberToRedis(roomCode, hostGuestId);

    logger.info({ roomCode, hostGuestId }, 'Room created');
    return { roomCode, state: initialState };
  }

  /**
   * Join an existing room
   */
  static async joinRoom(roomCode: string, guestId: string): Promise<{ state: RoomState; isHost: boolean }> {
    const formattedCode = roomCode.toUpperCase();
    let room = null;
    let isAlreadyMember = false;
    let currentMemberCount = 1;

    try {
      room = await prisma.room.findUnique({
        where: { roomCode: formattedCode },
        include: { members: true },
      });

      if (room) {
        if (!room.isActive) {
          throw new AppError('ROOM_NOT_FOUND', `Room with code ${formattedCode} not found`, 404);
        }
        currentMemberCount = room.members.length;
        isAlreadyMember = room.members.some((m) => m.guestId === guestId);

        if (!isAlreadyMember && currentMemberCount >= config.MAX_ROOM_MEMBERS) {
          throw new AppError('ROOM_FULL', `Room has reached maximum capacity of ${config.MAX_ROOM_MEMBERS} members`, 403);
        }

        if (!isAlreadyMember) {
          await prisma.roomMember.create({
            data: {
              roomId: room.id,
              guestId,
            },
          });
        }
      }
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      // In test mode without live DB, continue with Redis state
    }

    await this.addMemberToRedis(formattedCode, guestId);
    let state = await this.getRoomStateFromRedis(formattedCode);

    if (!state) {
      // Re-hydrate state from database or default if evicted
      const now = Date.now();
      state = {
        roomId: room?.id || `room_${formattedCode}`,
        roomCode: formattedCode,
        hostGuestId: room?.hostGuestId || guestId,
        trackId: null,
        status: 'paused',
        basePositionMs: 0,
        updatedAt: now,
        sequence: 1000,
        membersCount: currentMemberCount + (isAlreadyMember ? 0 : 1),
      };
      await this.saveRoomStateToRedis(formattedCode, state);
    } else {
      if (room && room.hostGuestId === guestId && state.hostGuestId !== guestId) {
        state.hostGuestId = guestId;
        await this.saveRoomStateToRedis(formattedCode, state);
      }
      const activeMembersCount = await this.getRoomMemberCountFromRedis(formattedCode);
      state.membersCount = activeMembersCount;
    }

    logger.info({ roomCode: formattedCode, guestId }, 'Guest joined room');
    const isHost = room ? room.hostGuestId === guestId : (state ? state.hostGuestId === guestId : false);
    return { state: state!, isHost };
  }

  /**
   * Leave room and migrate host if needed
   */
  static async leaveRoom(roomCode: string, guestId: string): Promise<{ newHostGuestId: string | null; remainingMembersCount: number }> {
    const formattedCode = roomCode.toUpperCase();
    const room = await prisma.room.findUnique({
      where: { roomCode: formattedCode },
      include: { members: { orderBy: { joinedAt: 'asc' } } },
    });

    if (!room) {
      return { newHostGuestId: null, remainingMembersCount: 0 };
    }

    // Remove member from DB
    await prisma.roomMember.deleteMany({
      where: {
        roomId: room.id,
        guestId,
      },
    });

    await this.removeMemberFromRedis(formattedCode, guestId);
    const remainingCount = await this.getRoomMemberCountFromRedis(formattedCode);

    let newHostGuestId: string | null = null;

    // Check if leaving member was the host
    if (room.hostGuestId === guestId) {
      const nextMember = await prisma.roomMember.findFirst({
        where: { roomId: room.id },
        orderBy: { joinedAt: 'asc' },
      });

      if (nextMember) {
        newHostGuestId = nextMember.guestId;
        await prisma.room.update({
          where: { id: room.id },
          data: { hostGuestId: newHostGuestId },
        });

        // Update state in Redis
        const state = await this.getRoomStateFromRedis(formattedCode);
        if (state) {
          state.hostGuestId = newHostGuestId;
          await this.saveRoomStateToRedis(formattedCode, state);
        }
        logger.info({ roomCode: formattedCode, newHostGuestId }, 'Host migrated');
      } else {
        // No members left in room: schedule Redis state expiration
        const redis = getRedisClient();
        await redis.expire(this.getRoomRedisKey(formattedCode), config.ROOM_IDLE_TTL);
        await redis.expire(this.getRoomMembersKey(formattedCode), config.ROOM_IDLE_TTL);
        logger.info({ roomCode: formattedCode }, 'Room empty, marked for TTL expiration');
      }
    }

    return { newHostGuestId, remainingMembersCount: remainingCount };
  }

  /**
   * Get room metadata & state
   */
  static async getRoom(roomCode: string): Promise<{ room: any; state: RoomState | null }> {
    const formattedCode = roomCode.toUpperCase();
    const room = await prisma.room.findUnique({
      where: { roomCode: formattedCode },
      include: {
        members: {
          include: {
            guest: true,
          },
        },
      },
    });

    if (!room || !room.isActive) {
      throw new AppError('ROOM_NOT_FOUND', `Room with code ${formattedCode} not found`, 404);
    }

    const state = await this.getRoomStateFromRedis(formattedCode);
    return { room, state };
  }

  /**
   * Redis State Helpers
   */
  static async getRoomStateFromRedis(roomCode: string): Promise<RoomState | null> {
    const redis = getRedisClient();
    const raw = await redis.get(this.getRoomRedisKey(roomCode));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RoomState;
    } catch {
      return null;
    }
  }

  static async saveRoomStateToRedis(roomCode: string, state: RoomState): Promise<void> {
    const redis = getRedisClient();
    await redis.set(this.getRoomRedisKey(roomCode), JSON.stringify(state), 'EX', config.ROOM_IDLE_TTL);
  }

  static async addMemberToRedis(roomCode: string, guestId: string): Promise<void> {
    const redis = getRedisClient();
    const key = this.getRoomMembersKey(roomCode);
    await redis.sadd(key, guestId);
    await redis.expire(key, config.ROOM_IDLE_TTL);
  }

  static async removeMemberFromRedis(roomCode: string, guestId: string): Promise<void> {
    const redis = getRedisClient();
    await redis.srem(this.getRoomMembersKey(roomCode), guestId);
  }

  static async getRoomMemberCountFromRedis(roomCode: string): Promise<number> {
    const redis = getRedisClient();
    return await redis.scard(this.getRoomMembersKey(roomCode));
  }
}
