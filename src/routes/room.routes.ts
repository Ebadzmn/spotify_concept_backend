import { Router, Response, NextFunction } from 'express';
import { RoomService } from '../services/room.service.js';
import { requireGuestAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { createRoomSchema, roomCodeParamSchema } from '../validators/index.js';

export const roomRouter = Router();

/**
 * POST /api/rooms
 * Create a new listening room. Creator becomes the host.
 */
roomRouter.post('/', requireGuestAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { initialTrackId } = createRoomSchema.parse(req.body);
    const guestId = req.guest!.guestId;

    const { roomCode, state } = await RoomService.createRoom(guestId, initialTrackId);

    res.status(201).json({
      success: true,
      roomCode,
      state,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/rooms/:roomCode
 * Fetch room metadata and current playback state.
 */
roomRouter.get('/:roomCode', requireGuestAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { roomCode } = roomCodeParamSchema.parse(req.params);
    const { room, state } = await RoomService.getRoom(roomCode);

    res.status(200).json({
      success: true,
      room: {
        id: room.id,
        roomCode: room.roomCode,
        hostGuestId: room.hostGuestId,
        isActive: room.isActive,
        createdAt: room.createdAt,
        members: room.members.map((m: any) => ({
          guestId: m.guestId,
          displayName: m.guest.displayName,
          joinedAt: m.joinedAt,
        })),
      },
      state,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/rooms/:roomCode/join
 * Join an existing room via REST.
 */
roomRouter.post('/:roomCode/join', requireGuestAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { roomCode } = roomCodeParamSchema.parse(req.params);
    const guestId = req.guest!.guestId;

    const { state, isHost } = await RoomService.joinRoom(roomCode, guestId);

    res.status(200).json({
      success: true,
      state,
      isHost,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/rooms/:roomCode/leave
 * Leave a room via REST.
 */
roomRouter.post('/:roomCode/leave', requireGuestAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { roomCode } = roomCodeParamSchema.parse(req.params);
    const guestId = req.guest!.guestId;

    const result = await RoomService.leaveRoom(roomCode, guestId);

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    next(err);
  }
});
