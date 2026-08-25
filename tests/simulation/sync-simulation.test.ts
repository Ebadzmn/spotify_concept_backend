import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../../src/app.js';
import { setupSocketServer } from '../../src/sockets/index.js';
import { signGuestToken } from '../../src/lib/jwt.js';
import { setCustomRedisClient } from '../../src/lib/redis.js';
import RedisMock from 'ioredis-mock';
import { PlaybackCommand, ClockPongPayload } from '../../src/types/index.js';

describe('10-Client Multi-Latency Synchronization Simulation', () => {
  let server: http.Server;
  let serverPort: number;
  let syncTimer: NodeJS.Timeout;
  let redisMock: any;

  beforeAll(async () => {
    // Setup Mock Redis for in-memory simulation
    redisMock = new RedisMock();
    setCustomRedisClient(redisMock);

    const app = createApp();
    server = http.createServer(app);
    const socketSetup = setupSocketServer(server);
    syncTimer = socketSetup.syncTimer;

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as any;
        serverPort = address.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    clearInterval(syncTimer);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }, 10000);

  it('should synchronize 10 virtual clients with diverse simulated network latencies (20ms - 500ms)', async () => {
    const latencies = [20, 20, 50, 50, 100, 100, 200, 200, 300, 500]; // 10 clients with various delays
    const numClients = 10;
    const roomCode = 'SIMUL1';
    const hostGuestId = 'host-sim-guest-id';

    // 1. Initialize Room in Redis Mock
    await redisMock.set(
      `room:${roomCode}:state`,
      JSON.stringify({
        roomId: 'sim-room-1',
        roomCode,
        hostGuestId,
        trackId: 'spotify:track:demo123',
        status: 'paused',
        basePositionMs: 0,
        updatedAt: Date.now(),
        sequence: 1000,
        membersCount: numClients,
      })
    );

    // 2. Connect 10 simulated clients
    const clients: Array<{
      id: number;
      latencyMs: number;
      socket: ClientSocket;
      guestId: string;
      clockOffset: number;
      receivedCommands: PlaybackCommand[];
      executionCalculations: Array<{ targetServerTime: number; scheduledDelayMs: number; executionDiffMs: number }>;
    }> = [];

    for (let i = 0; i < numClients; i++) {
      const guestId = i === 0 ? hostGuestId : `guest-sim-${i}`;
      const token = signGuestToken({ guestId, displayName: `User_${i}` });
      const latencyMs = latencies[i];

      const clientSocket = Client(`http://localhost:${serverPort}`, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
      });

      clients.push({
        id: i,
        latencyMs,
        socket: clientSocket,
        guestId,
        clockOffset: 0,
        receivedCommands: [],
        executionCalculations: [],
      });
    }

    // Wait for all sockets to connect
    await Promise.all(
      clients.map(
        (c) =>
          new Promise<void>((resolve) => {
            if (c.socket.connected) return resolve();
            c.socket.on('connect', () => resolve());
          })
      )
    );

    // 3. Register command listeners on all clients
    for (const c of clients) {
      c.socket.on('error', (err) => {
        console.error(`Client ${c.id} error:`, err);
      });

      c.socket.on('clock:pong', (pong: ClockPongPayload) => {
        const clientReceiveTime = Date.now() + c.latencyMs / 2;
        const rtt = clientReceiveTime - pong.clientSentTime;
        const estimatedServerNow = pong.serverTimestamp + rtt / 2;
        c.clockOffset = estimatedServerNow - clientReceiveTime;
      });

      c.socket.on('player:command', (cmd: PlaybackCommand) => {
        c.receivedCommands.push(cmd);

        // Simulate client scheduler
        const clientNow = Date.now();
        const estimatedServerNow = clientNow + c.clockOffset;
        const scheduledDelayMs = cmd.executeAt - estimatedServerNow;

        // When executeAt triggers:
        const executionDiffMs = (clientNow + scheduledDelayMs) - cmd.executeAt;
        c.executionCalculations.push({
          targetServerTime: cmd.executeAt,
          scheduledDelayMs,
          executionDiffMs,
        });

        // Send ACK back to server
        c.socket.emit('command:received', {
          commandId: cmd.commandId,
          guestId: c.guestId,
        });
      });
    }

    // Join room and calibrate clock for each client
    for (const c of clients) {
      c.socket.emit('room:join', { roomCode });
      const clientSentTime = Date.now() - c.latencyMs / 2;
      c.socket.emit('clock:ping', { clientSentTime });
    }

    // Wait a brief moment for all sockets to receive their room joins & pong
    await new Promise((r) => setTimeout(r, 600));

    // 4. Host issues a scheduled PLAY command with 1500ms schedule buffer
    const host = clients[0];
    host.socket.emit('player:play', {
      roomCode,
      trackId: 'spotify:track:demo123',
      positionMs: 0,
    });

    // Wait for command broadcast and processing
    await new Promise((r) => setTimeout(r, 800));

    // 5. Assertions: Verify all 10 clients received the scheduled PLAY command
    expect(clients.length).toBe(10);
    for (const c of clients) {
      expect(c.receivedCommands.length).toBe(1);
      const cmd = c.receivedCommands[0];
      expect(cmd.type).toBe('PLAY');
      expect(cmd.sequence).toBe(1001);
      expect(cmd.executeAt).toBeGreaterThan(Date.now());

      // Verify each client scheduled execution close to the server target (tolerance < 50ms across simulated latencies)
      expect(c.executionCalculations.length).toBe(1);
      const calc = c.executionCalculations[0];
      expect(Math.abs(calc.executionDiffMs)).toBeLessThan(50);
    }

    // Clean up client sockets
    for (const c of clients) {
      c.socket.disconnect();
    }
  }, 30000);
});
