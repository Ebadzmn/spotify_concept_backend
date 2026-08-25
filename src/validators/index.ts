import { z } from 'zod';

export const createGuestSessionSchema = z.object({
  guestId: z.string().uuid({ message: 'guestId must be a valid UUID v4' }),
  displayName: z.string().min(1).max(50).optional().nullable(),
});

export const createRoomSchema = z.object({
  initialTrackId: z.string().optional().nullable(),
});

export const roomCodeParamSchema = z.object({
  roomCode: z.string().min(4).max(10).toUpperCase(),
});

export const clockPingSchema = z.object({
  clientSentTime: z.number().positive(),
});

export const roomJoinSchema = z.object({
  roomCode: z.string().min(4).max(10).toUpperCase(),
});

export const playerPlaySchema = z.object({
  roomCode: z.string().min(4).max(10).toUpperCase(),
  trackId: z.string().optional(),
  positionMs: z.number().min(0).optional(),
  scheduleBufferMs: z.number().min(0).max(10000).optional(),
});

export const playerPauseSchema = z.object({
  roomCode: z.string().min(4).max(10).toUpperCase(),
  positionMs: z.number().min(0).optional(),
});

export const playerSeekSchema = z.object({
  roomCode: z.string().min(4).max(10).toUpperCase(),
  positionMs: z.number().min(0),
});

export const playerTrackChangeSchema = z.object({
  roomCode: z.string().min(4).max(10).toUpperCase(),
  trackId: z.string().min(1, { message: 'trackId is required' }),
});

export const commandReceivedAckSchema = z.object({
  commandId: z.string().min(1),
  guestId: z.string().min(1),
});

export const commandExecutedAckSchema = z.object({
  commandId: z.string().min(1),
  guestId: z.string().min(1),
  actualPositionMs: z.number().min(0),
});

export const syncHealthSchema = z.object({
  rttMs: z.number().min(0).max(60000),
  jitterMs: z.number().min(0).max(60000),
  spotifyReady: z.boolean(),
});
