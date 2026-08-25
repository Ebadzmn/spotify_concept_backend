import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { getRedisPubClient, getRedisSubClient } from '../lib/redis.js';
import { ClientToServerEvents, ServerToClientEvents, SocketData } from '../types/index.js';
import { socketAuthMiddleware } from './socketAuthMiddleware.js';
import { registerClockHandlers } from './clockHandler.js';
import { registerRoomHandlers } from './roomHandler.js';
import { registerPlayerHandlers } from './playerHandler.js';
import { registerAckHandlers } from './ackHandler.js';
import { startPeriodicSyncEngine } from './syncTicker.js';
import { RoomService } from '../services/room.service.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';

export function setupSocketServer(httpServer: HttpServer): {
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, any, SocketData>;
  syncTimer: NodeJS.Timeout;
} {
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, any, SocketData>(httpServer, {
    cors: {
      origin: config.CORS_ORIGIN,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Setup Redis Adapter for multi-instance horizontal scaling if not in test
  if (config.NODE_ENV !== 'test') {
    try {
      const pubClient = getRedisPubClient();
      const subClient = getRedisSubClient();
      io.adapter(createAdapter(pubClient, subClient));
      logger.info('Socket.IO Redis adapter enabled for multi-instance scaling');
    } catch (err) {
      logger.warn({ err }, 'Failed to initialize Redis adapter for Socket.IO');
    }
  }

  // Socket Auth Middleware
  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id, guestId: socket.data.guest.guestId }, 'Socket connected');

    // Register all event sub-handlers
    registerClockHandlers(io, socket);
    registerRoomHandlers(io, socket);
    registerPlayerHandlers(io, socket);
    registerAckHandlers(io, socket);

    socket.on('disconnect', (reason) => {
      const guestId = socket.data.guest?.guestId;
      logger.info({ socketId: socket.id, guestId, reason }, 'Socket disconnected');

      const currentRoom = socket.data.currentRoomCode;
      if (currentRoom && guestId) {
        // Wait a 5s grace period before evicting to allow mobile clients to reconnect without losing host status
        setTimeout(async () => {
          try {
            const sockets = await io.in(currentRoom).fetchSockets();
            const isStillConnected = sockets.some((s) => s.data.guest?.guestId === guestId);
            if (isStillConnected) {
              logger.info({ guestId, currentRoom }, 'Guest reconnected, skipping leaveRoom cleanup');
              return;
            }

            const { newHostGuestId, remainingMembersCount } = await RoomService.leaveRoom(
              currentRoom,
              guestId
            );

            io.to(currentRoom).emit('room:left', {
              guestId,
              membersCount: remainingMembersCount,
            });

            if (newHostGuestId) {
              io.to(currentRoom).emit('room:host_changed', { newHostGuestId });
            }
          } catch (err) {
            logger.error({ err }, 'Error cleaning up room on disconnect');
          }
        }, 5000);
      }
    });
  });

  // Start periodic sync heartbeat
  const syncTimer = startPeriodicSyncEngine(io);

  return { io, syncTimer };
}
