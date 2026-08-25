import { Socket, Server } from 'socket.io';
import { ClientToServerEvents, ServerToClientEvents, SocketData, SocketErrorResponse } from '../types/index.js';
import {
  playerPlaySchema,
  playerPauseSchema,
  playerSeekSchema,
  playerTrackChangeSchema,
} from '../validators/index.js';
import { PlaybackService } from '../services/playback.service.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';

async function getAdaptiveScheduleBufferMs(
  io: Server<ClientToServerEvents, ServerToClientEvents, any, SocketData>,
  roomCode: string,
): Promise<number> {
  const sockets = await io.in(roomCode).fetchSockets();
  const health = sockets.map((roomSocket) => roomSocket.data.syncHealth).filter(Boolean);
  if (health.length === 0) return config.SCHEDULE_BUFFER_MS;

  const worstLeadTime = Math.max(...health.map((sample) => sample!.rttMs + (sample!.jitterMs * 2) + 250));
  const allReady = health.every((sample) => sample!.spotifyReady);
  const adaptive = Math.max(800, Math.min(2500, Math.ceil(worstLeadTime)));
  return allReady ? adaptive : Math.max(config.SCHEDULE_BUFFER_MS, adaptive);
}

export function registerPlayerHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents, any, SocketData>,
  socket: Socket<ClientToServerEvents, ServerToClientEvents, any, SocketData>
) {
  const guest = socket.data.guest;

  socket.on('track:prepare', async (data) => {
    try {
      const parsed = playerTrackChangeSchema.parse(data);
      const roomCode = parsed.roomCode.toUpperCase();
      await PlaybackService.validateHost(roomCode, guest.guestId);
      io.to(roomCode).emit('track:prepare', { trackId: parsed.trackId });
    } catch (err: any) {
      handleSocketError(socket, err);
    }
  });

  socket.on('track:ready', (data) => {
    const parsed = playerTrackChangeSchema.safeParse(data);
    if (!parsed.success) return;
    const roomCode = parsed.data.roomCode.toUpperCase();
    if (socket.data.currentRoomCode !== roomCode) return;
    io.to(roomCode).emit('track:readiness', {
      guestId: guest.guestId,
      trackId: parsed.data.trackId,
      ready: true,
    });
  });

  /**
   * player:play
   */
  socket.on('player:play', async (data) => {
    try {
      const parsed = playerPlaySchema.parse(data);
      const roomCode = parsed.roomCode.toUpperCase();
      const defaultBuffer = await getAdaptiveScheduleBufferMs(io, roomCode);
      const scheduleBufferMs = parsed.scheduleBufferMs !== undefined ? parsed.scheduleBufferMs : defaultBuffer;
      const { command } = await PlaybackService.handlePlay(
        roomCode,
        guest.guestId,
        parsed.trackId,
        parsed.positionMs,
        scheduleBufferMs,
      );

      // Broadcast scheduled command to all room participants
      io.to(roomCode).emit('player:command', command);
    } catch (err: any) {
      handleSocketError(socket, err);
    }
  });

  /**
   * player:pause
   */
  socket.on('player:pause', async (data) => {
    try {
      const parsed = playerPauseSchema.parse(data);
      const roomCode = parsed.roomCode.toUpperCase();
      const scheduleBufferMs = await getAdaptiveScheduleBufferMs(io, roomCode);
      const { command } = await PlaybackService.handlePause(
        roomCode,
        guest.guestId,
        parsed.positionMs,
        scheduleBufferMs,
      );

      io.to(roomCode).emit('player:command', command);
    } catch (err: any) {
      handleSocketError(socket, err);
    }
  });

  /**
   * player:seek
   */
  socket.on('player:seek', async (data) => {
    try {
      const parsed = playerSeekSchema.parse(data);
      const roomCode = parsed.roomCode.toUpperCase();
      const scheduleBufferMs = await getAdaptiveScheduleBufferMs(io, roomCode);
      const { command } = await PlaybackService.handleSeek(
        roomCode,
        guest.guestId,
        parsed.positionMs,
        scheduleBufferMs,
      );

      io.to(roomCode).emit('player:command', command);
    } catch (err: any) {
      handleSocketError(socket, err);
    }
  });

  /**
   * player:next
   */
  socket.on('player:next', async (data) => {
    try {
      const parsed = playerTrackChangeSchema.parse(data);
      const roomCode = parsed.roomCode.toUpperCase();
      const scheduleBufferMs = await getAdaptiveScheduleBufferMs(io, roomCode);
      const { command } = await PlaybackService.handleTrackChange(
        roomCode,
        guest.guestId,
        'NEXT',
        parsed.trackId,
        scheduleBufferMs,
      );

      io.to(roomCode).emit('player:command', command);
    } catch (err: any) {
      handleSocketError(socket, err);
    }
  });

  /**
   * player:previous
   */
  socket.on('player:previous', async (data) => {
    try {
      const parsed = playerTrackChangeSchema.parse(data);
      const roomCode = parsed.roomCode.toUpperCase();
      const scheduleBufferMs = await getAdaptiveScheduleBufferMs(io, roomCode);
      const { command } = await PlaybackService.handleTrackChange(
        roomCode,
        guest.guestId,
        'PREVIOUS',
        parsed.trackId,
        scheduleBufferMs,
      );

      io.to(roomCode).emit('player:command', command);
    } catch (err: any) {
      handleSocketError(socket, err);
    }
  });
}

function handleSocketError(socket: Socket<any, any, any, any>, err: any) {
  const errorResponse: SocketErrorResponse = {
    code: err.code || 'INVALID_COMMAND',
    message: err.message || 'Error processing playback command',
  };
  logger.warn({ errorResponse }, 'Player command rejected');
  socket.emit('error', errorResponse);
}
