import { Server, Socket } from 'socket.io';
import { SocketData } from '../types/index.js';
import { logger } from '../lib/logger.js';

function formatPayload(args: unknown[]): unknown {
  if (args.length === 0) return undefined;
  return args.length === 1 ? args[0] : args;
}

function wrapOperator(operator: any, targetRooms: string[]): any {
  const originalEmit = operator.emit.bind(operator);
  operator.emit = (event: string | symbol, ...args: any[]) => {
    const roomLabel = targetRooms.join(', ');
    logger.info(
      {
        room: roomLabel,
        event: String(event),
        payload: formatPayload(args),
      },
      `📡 [SOCKET BROADCAST] ${String(event)} -> room:${roomLabel}`
    );
    return originalEmit(event, ...args);
  };

  if (typeof operator.to === 'function') {
    const originalChainedTo = operator.to.bind(operator);
    operator.to = (room: string | string[]) => {
      const nextRooms = [...targetRooms, ...(Array.isArray(room) ? room : [room])];
      return wrapOperator(originalChainedTo(room), nextRooms);
    };
  }

  if (typeof operator.in === 'function') {
    const originalChainedIn = operator.in.bind(operator);
    operator.in = (room: string | string[]) => {
      const nextRooms = [...targetRooms, ...(Array.isArray(room) ? room : [room])];
      return wrapOperator(originalChainedIn(room), nextRooms);
    };
  }

  return operator;
}

/**
 * Wraps io.to and io.in to log all room-level Socket.IO broadcasts.
 */
export function attachServerSocketLogger(io: Server<any, any, any, SocketData>): void {
  const originalTo = io.to.bind(io);
  const originalIn = io.in.bind(io);

  io.to = ((room: string | string[]) => {
    const rooms = Array.isArray(room) ? room : [room];
    return wrapOperator(originalTo(room), rooms);
  }) as typeof io.to;

  io.in = ((room: string | string[]) => {
    const rooms = Array.isArray(room) ? room : [room];
    return wrapOperator(originalIn(room), rooms);
  }) as typeof io.in;
}

/**
 * Attaches connection, incoming event, acknowledgement callback, and outgoing emission loggers to a socket.
 */
export function attachClientSocketLogger(socket: Socket<any, any, any, SocketData>): void {
  const guestId = socket.data.guest?.guestId;
  const displayName = socket.data.guest?.displayName;
  const ip = socket.handshake.address;

  logger.info(
    { socketId: socket.id, guestId, displayName, ip },
    '🟢 [SOCKET CONNECTED]'
  );

  socket.use((packet, next) => {
    const [event, ...args] = packet;
    const hasAck = args.length > 0 && typeof args[args.length - 1] === 'function';
    const payloadArgs = hasAck ? args.slice(0, -1) : args;

    logger.info(
      {
        socketId: socket.id,
        guestId,
        room: socket.data.currentRoomCode,
        event,
        payload: formatPayload(payloadArgs),
      },
      `📨 [SOCKET IN] ${event}`
    );

    if (hasAck) {
      const originalAck = packet[packet.length - 1] as (...ackArgs: unknown[]) => void;
      packet[packet.length - 1] = (...ackArgs: unknown[]) => {
        logger.info(
          {
            socketId: socket.id,
            guestId,
            room: socket.data.currentRoomCode,
            event,
            ackResponse: formatPayload(ackArgs),
          },
          `✅ [SOCKET ACK] ${event}`
        );
        originalAck(...ackArgs);
      };
    }

    next();
  });

  socket.onAnyOutgoing((event, ...args) => {
    logger.info(
      {
        socketId: socket.id,
        guestId,
        room: socket.data.currentRoomCode,
        event: String(event),
        response: formatPayload(args),
      },
      `📤 [SOCKET OUT] ${String(event)}`
    );
  });
}
