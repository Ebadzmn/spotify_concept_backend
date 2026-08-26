import { customAlphabet } from 'nanoid';
import { RoomService } from './room.service.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  RoomState,
  PlaybackCommand,
  SyncStatePayload,
  PlaybackStatus,
} from '../types/index.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

const generateCmdId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

export class PlaybackService {
  /**
   * Dynamically calculates current position based on server time and base position
   */
  static calculateCurrentPosition(state: RoomState, targetServerTime: number = Date.now()): number {
    if (state.status === 'playing') {
      const elapsed = Math.max(0, targetServerTime - state.updatedAt);
      return Math.round(state.basePositionMs + elapsed);
    }
    return Math.round(state.basePositionMs);
  }

  /**
   * Issue PLAY command (Host only)
   */
  static async handlePlay(
    roomCode: string,
    guestId: string,
    trackId?: string,
    positionMs?: number,
    scheduleBufferMs: number = 3000
  ): Promise<{ command: PlaybackCommand; newState: RoomState }> {
    const formattedCode = roomCode.toUpperCase();
    const state = await this.getValidatedHostState(formattedCode, guestId);

    const now = Date.now();
    const executeAt = now + scheduleBufferMs;
    const targetTrackId = trackId || state.trackId;

    if (!targetTrackId) {
      throw new AppError('INVALID_TRACK', 'No track specified for playback', 400);
    }

    const nextPosition = positionMs !== undefined ? positionMs : this.calculateCurrentPosition(state, now);
    const nextSequence = state.sequence + 1;
    const commandId = `cmd_${generateCmdId()}`;

    const newState: RoomState = {
      ...state,
      trackId: targetTrackId,
      status: 'playing',
      basePositionMs: nextPosition,
      updatedAt: executeAt, // Base position will be exact at executeAt
      sequence: nextSequence,
    };

    await RoomService.saveRoomStateToRedis(formattedCode, newState);

    const command: PlaybackCommand = {
      commandId,
      sequence: nextSequence,
      type: 'PLAY',
      trackId: targetTrackId,
      positionMs: nextPosition,
      executeAt,
      issuedAt: now,
    };

    logger.info({ roomCode: formattedCode, commandId, sequence: nextSequence, executeAt }, 'Issued PLAY command');
    return { command, newState };
  }

  /**
   * Issue PAUSE command (Host only)
   */
  static async handlePause(
    roomCode: string,
    guestId: string,
    positionMs?: number,
    scheduleBufferMs: number = 0
  ): Promise<{ command: PlaybackCommand; newState: RoomState }> {
    const formattedCode = roomCode.toUpperCase();
    const state = await this.getValidatedHostState(formattedCode, guestId);

    const now = Date.now();
    const executeAt = now + scheduleBufferMs;
    const positionAtExecute = positionMs !== undefined
      ? positionMs
      : this.calculateCurrentPosition(state, now);

    const nextSequence = state.sequence + 1;
    const commandId = `cmd_${generateCmdId()}`;

    const newState: RoomState = {
      ...state,
      status: 'paused',
      basePositionMs: positionAtExecute,
      updatedAt: now,
      sequence: nextSequence,
    };

    await RoomService.saveRoomStateToRedis(formattedCode, newState);

    const command: PlaybackCommand = {
      commandId,
      sequence: nextSequence,
      type: 'PAUSE',
      trackId: state.trackId,
      positionMs: positionAtExecute,
      executeAt,
      issuedAt: now,
    };

    logger.info({ roomCode: formattedCode, commandId, sequence: nextSequence, positionMs: positionAtExecute }, 'Issued instant PAUSE command');
    return { command, newState };
  }

  /**
   * Issue SEEK command (Host only)
   */
  static async handleSeek(
    roomCode: string,
    guestId: string,
    positionMs: number,
    scheduleBufferMs: number = config.SCHEDULE_BUFFER_MS
  ): Promise<{ command: PlaybackCommand; newState: RoomState }> {
    const formattedCode = roomCode.toUpperCase();
    const state = await this.getValidatedHostState(formattedCode, guestId);

    const now = Date.now();
    const executeAt = now + scheduleBufferMs;
    const nextSequence = state.sequence + 1;
    const commandId = `cmd_${generateCmdId()}`;

    const newState: RoomState = {
      ...state,
      basePositionMs: positionMs,
      updatedAt: executeAt,
      sequence: nextSequence,
    };

    await RoomService.saveRoomStateToRedis(formattedCode, newState);

    const command: PlaybackCommand = {
      commandId,
      sequence: nextSequence,
      type: 'SEEK',
      trackId: state.trackId,
      positionMs,
      executeAt,
      issuedAt: now,
    };

    logger.info({ roomCode: formattedCode, commandId, sequence: nextSequence, positionMs, executeAt }, 'Issued SEEK command');
    return { command, newState };
  }

  /**
   * Issue TRACK_CHANGE command (Next / Previous)
   */
  static async handleTrackChange(
    roomCode: string,
    guestId: string,
    type: 'NEXT' | 'PREVIOUS' | 'TRACK_CHANGE',
    newTrackId: string,
    scheduleBufferMs: number = 3000
  ): Promise<{ command: PlaybackCommand; newState: RoomState }> {
    const formattedCode = roomCode.toUpperCase();
    const state = await this.getValidatedHostState(formattedCode, guestId);

    if (state.status === 'playing') {
      throw new AppError(
        'MUST_PAUSE_BEFORE_TRACK_CHANGE',
        'Current track must be paused before changing tracks. Please pause playback first.',
        400
      );
    }

    const now = Date.now();
    const executeAt = now + scheduleBufferMs;
    const nextSequence = state.sequence + 1;
    const commandId = `cmd_${generateCmdId()}`;

    const newState: RoomState = {
      ...state,
      trackId: newTrackId,
      status: 'playing',
      basePositionMs: 0,
      updatedAt: executeAt,
      sequence: nextSequence,
    };

    await RoomService.saveRoomStateToRedis(formattedCode, newState);

    const command: PlaybackCommand = {
      commandId,
      sequence: nextSequence,
      type,
      trackId: newTrackId,
      positionMs: 0,
      executeAt,
      issuedAt: now,
    };

    logger.info({ roomCode: formattedCode, commandId, sequence: nextSequence, newTrackId, executeAt }, 'Issued TRACK_CHANGE command with 3s schedule buffer');
    return { command, newState };
  }

  /**
   * Generate authoritative sync payload for room (used in resync and periodic drift correction)
   */
  static async getRoomSyncPayload(roomCode: string): Promise<SyncStatePayload | null> {
    const formattedCode = roomCode.toUpperCase();
    const state = await RoomService.getRoomStateFromRedis(formattedCode);
    if (!state) return null;

    const now = Date.now();
    const currentPosition = this.calculateCurrentPosition(state, now);

    return {
      type: 'SYNC',
      roomId: state.roomId,
      trackId: state.trackId,
      status: state.status,
      positionMs: currentPosition,
      serverTimestamp: now,
      sequence: state.sequence,
    };
  }

  static async validateHost(roomCode: string, guestId: string): Promise<void> {
    await this.getValidatedHostState(roomCode.toUpperCase(), guestId);
  }

  /**
   * Validate that room exists and caller is host
   */
  private static async getValidatedHostState(roomCode: string, guestId: string): Promise<RoomState> {
    const state = await RoomService.getRoomStateFromRedis(roomCode);
    if (!state) {
      throw new AppError('ROOM_NOT_FOUND', `Room ${roomCode} state not found`, 404);
    }

    if (state.hostGuestId !== guestId) {
      throw new AppError('NOT_ROOM_HOST', 'Only the room host can control playback', 403);
    }

    return state;
  }
}
