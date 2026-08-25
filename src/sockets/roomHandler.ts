import { Socket, Server } from 'socket.io';
import { ClientToServerEvents, ServerToClientEvents, SocketData, SocketErrorResponse } from '../types/index.js';
import { roomJoinSchema } from '../validators/index.js';
import { RoomService } from '../services/room.service.js';
import { PlaybackService } from '../services/playback.service.js';
import { logger } from '../lib/logger.js';

export function registerRoomHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents, any, SocketData>,
  socket: Socket<ClientToServerEvents, ServerToClientEvents, any, SocketData>
) {
  const guest = socket.data.guest;

  /**
   * room:join
   */
  socket.on('room:join', async (data, callback) => {
    try {
      const parsed = roomJoinSchema.safeParse(data);
      if (!parsed.success) {
        const errorResponse: SocketErrorResponse = {
          code: 'INVALID_COMMAND',
          message: 'Invalid roomCode parameter',
        };
        socket.emit('error', errorResponse);
        callback?.({ success: false, error: errorResponse });
        return;
      }

      const roomCode = parsed.data.roomCode.toUpperCase();
      const { state } = await RoomService.joinRoom(roomCode, guest.guestId);

      // Leave prior room if any
      if (socket.data.currentRoomCode && socket.data.currentRoomCode !== roomCode) {
        socket.leave(socket.data.currentRoomCode);
      }

      socket.join(roomCode);
      socket.data.currentRoomCode = roomCode;

      // Broadcast room joined to all room participants
      io.to(roomCode).emit('room:joined', {
        guestId: guest.guestId,
        displayName: guest.displayName,
        membersCount: state.membersCount || 1,
      });

      // Send latest authoritative state to joining socket
      socket.emit('room:state', state);

      callback?.({ success: true });
      logger.info({ roomCode, guestId: guest.guestId }, 'Socket joined room successfully');
    } catch (err: any) {
      const errorResponse: SocketErrorResponse = {
        code: err.code || 'INTERNAL_ERROR',
        message: err.message || 'Failed to join room',
      };
      socket.emit('error', errorResponse);
      callback?.({ success: false, error: errorResponse });
    }
  });

  /**
   * room:leave
   */
  socket.on('room:leave', async (data, callback) => {
    try {
      const roomCode = data?.roomCode?.toUpperCase() || socket.data.currentRoomCode;
      if (!roomCode) {
        callback?.({ success: true });
        return;
      }

      socket.leave(roomCode);
      socket.data.currentRoomCode = undefined;

      const { newHostGuestId, remainingMembersCount } = await RoomService.leaveRoom(roomCode, guest.guestId);

      io.to(roomCode).emit('room:left', {
        guestId: guest.guestId,
        membersCount: remainingMembersCount,
      });

      if (newHostGuestId) {
        io.to(roomCode).emit('room:host_changed', { newHostGuestId });
      }

      callback?.({ success: true });
    } catch (err: any) {
      logger.error({ err }, 'Error during room:leave socket event');
      callback?.({ success: false });
    }
  });

  /**
   * room:resync (Mandatory for reconnect / resynchronization)
   */
  socket.on('room:resync', async (data, callback) => {
    try {
      const roomCode = data?.roomCode?.toUpperCase() || socket.data.currentRoomCode;
      if (!roomCode) {
        const errResp: SocketErrorResponse = { code: 'NOT_ROOM_MEMBER', message: 'Not connected to a room' };
        socket.emit('error', errResp);
        callback?.({ success: false, error: errResp });
        return;
      }

      const syncPayload = await PlaybackService.getRoomSyncPayload(roomCode);
      if (!syncPayload) {
        const errResp: SocketErrorResponse = { code: 'ROOM_NOT_FOUND', message: 'Room state not found' };
        socket.emit('error', errResp);
        callback?.({ success: false, error: errResp });
        return;
      }

      socket.emit('player:sync', syncPayload);
      callback?.({ success: true, data: syncPayload });
    } catch (err: any) {
      const errResp: SocketErrorResponse = { code: 'INTERNAL_ERROR', message: err.message };
      socket.emit('error', errResp);
      callback?.({ success: false, error: errResp });
    }
  });
}
