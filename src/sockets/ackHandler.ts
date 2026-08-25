import { Socket, Server } from 'socket.io';
import { ClientToServerEvents, ServerToClientEvents, SocketData } from '../types/index.js';
import { commandReceivedAckSchema, commandExecutedAckSchema, syncHealthSchema } from '../validators/index.js';
import { logger } from '../lib/logger.js';

export function registerAckHandlers(
  _io: Server<ClientToServerEvents, ServerToClientEvents, any, SocketData>,
  socket: Socket<ClientToServerEvents, ServerToClientEvents, any, SocketData>
) {
  /**
   * command:received (Client receipt acknowledgement)
   */
  socket.on('command:received', (data) => {
    const parsed = commandReceivedAckSchema.safeParse(data);
    if (!parsed.success) return;

    logger.debug(
      { commandId: parsed.data.commandId, guestId: parsed.data.guestId },
      'Command received ACK'
    );
  });

  /**
   * command:executed (Client execution status & measured position)
   */
  socket.on('command:executed', (data) => {
    const parsed = commandExecutedAckSchema.safeParse(data);
    if (!parsed.success) return;

    logger.debug(
      {
        commandId: parsed.data.commandId,
        guestId: parsed.data.guestId,
        actualPositionMs: parsed.data.actualPositionMs,
      },
      'Command executed ACK'
    );
  });

  socket.on('sync:health', (data) => {
    const parsed = syncHealthSchema.safeParse(data);
    if (!parsed.success) return;
    socket.data.syncHealth = parsed.data;
  });
}
