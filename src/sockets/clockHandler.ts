import { Socket, Server } from 'socket.io';
import { ClientToServerEvents, ServerToClientEvents, SocketData } from '../types/index.js';
import { clockPingSchema } from '../validators/index.js';

export function registerClockHandlers(
  _io: Server<ClientToServerEvents, ServerToClientEvents, any, SocketData>,
  socket: Socket<ClientToServerEvents, ServerToClientEvents, any, SocketData>
) {
  /**
   * High precision clock ping / pong for RTT and clock offset calculation
   */
  socket.on('clock:ping', (data) => {
    const result = clockPingSchema.safeParse(data);
    if (!result.success) return;

    const serverTimestamp = Date.now();
    socket.emit('clock:pong', {
      clientSentTime: result.data.clientSentTime,
      serverTimestamp,
    });
  });
}
