import { Server } from 'socket.io';
import { ClientToServerEvents, ServerToClientEvents, SocketData } from '../types/index.js';
import { PlaybackService } from '../services/playback.service.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

/**
 * Lightweight periodic room sync engine.
 * Emits authoritative room sync state to all connected rooms every SYNC_INTERVAL_MS.
 */
export function startPeriodicSyncEngine(
  io: Server<ClientToServerEvents, ServerToClientEvents, any, SocketData>
): NodeJS.Timeout {
  logger.info(`Starting periodic room sync engine (interval: ${config.SYNC_INTERVAL_MS}ms)`);

  const intervalId = setInterval(async () => {
    try {
      // Get all active rooms currently registered in Socket.IO adapter
      const adapter = io.sockets.adapter;
      const rooms = adapter.rooms;

      for (const [roomCode, socketIds] of rooms.entries()) {
        // Skip individual socket private rooms (socketId === roomCode)
        if (socketIds.size > 0 && !adapter.sids.has(roomCode)) {
          const syncPayload = await PlaybackService.getRoomSyncPayload(roomCode);
          if (syncPayload && syncPayload.status === 'playing') {
            io.to(roomCode).emit('player:sync', syncPayload);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error during periodic sync tick');
    }
  }, config.SYNC_INTERVAL_MS);

  return intervalId;
}
