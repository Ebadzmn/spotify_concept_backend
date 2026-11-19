import http from 'http';
import os from 'os';
import { createApp } from './app.js';
import { setupSocketServer } from './sockets/index.js';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { getRedisClient, getRedisPubClient, getRedisSubClient } from './lib/redis.js';

function getNetworkAddresses(): { name: string; address: string }[] {
  const interfaces = os.networkInterfaces();
  const addresses: { name: string; address: string }[] = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) {
        addresses.push({ name, address: entry.address });
      }
    }
  }

  return addresses;
}

async function bootstrap() {
  const app = createApp();
  const server = http.createServer(app);
  const { io, syncTimer } = setupSocketServer(server);

  server.listen(config.PORT, '0.0.0.0', () => {
    const networkAddresses = getNetworkAddresses();
    const networkUrls = networkAddresses.map(
      (net) => `http://${net.address}:${config.PORT} (${net.name})`
    );
    const swaggerNetworkUrls = networkAddresses.map(
      (net) => `http://${net.address}:${config.PORT}/api/docs`
    );
    const socketNetworkUrls = networkAddresses.map(
      (net) => `ws://${net.address}:${config.PORT}`
    );

    logger.info(
      {
        env: config.NODE_ENV,
        port: config.PORT,
        local: [
          `http://localhost:${config.PORT}`,
          `http://127.0.0.1:${config.PORT}`,
        ],
        network: networkUrls.length ? networkUrls : ['No external IPv4 network interface detected'],
        health: `http://localhost:${config.PORT}/api/health`,
        swagger: [
          `http://localhost:${config.PORT}/api/docs`,
          ...swaggerNetworkUrls,
        ],
        socketIO: [
          `ws://localhost:${config.PORT}`,
          ...socketNetworkUrls,
        ],
      },
      `🚀 Synchronized Music Room server started on port ${config.PORT} [${config.NODE_ENV}]`
    );
  });

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    clearInterval(syncTimer);

    // Close Socket.IO connections
    await new Promise<void>((resolve) => {
      io.close(() => {
        logger.info('Socket.IO connections closed.');
        resolve();
      });
    });

    // Close HTTP Server
    await new Promise<void>((resolve) => {
      server.close(() => {
        logger.info('HTTP server closed.');
        resolve();
      });
    });

    // Disconnect Redis clients
    try {
      const redis = getRedisClient();
      const pub = getRedisPubClient();
      const sub = getRedisSubClient();
      await Promise.all([redis.quit(), pub.quit(), sub.quit()]);
      logger.info('Redis connections closed.');
    } catch (err) {
      logger.warn({ err }, 'Error closing Redis connections');
    }

    // Disconnect Prisma
    await prisma.$disconnect();
    logger.info('Prisma disconnected.');

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Fatal error during application startup');
  process.exit(1);
});
