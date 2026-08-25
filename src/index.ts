import http from 'http';
import { createApp } from './app.js';
import { setupSocketServer } from './sockets/index.js';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { getRedisClient, getRedisPubClient, getRedisSubClient } from './lib/redis.js';

async function bootstrap() {
  const app = createApp();
  const server = http.createServer(app);
  const { io, syncTimer } = setupSocketServer(server);

  server.listen(config.PORT, () => {
    logger.info(`Synchronized Music Room server started on port ${config.PORT} [${config.NODE_ENV}]`);
    logger.info(`Swagger API docs available at http://localhost:${config.PORT}/api/docs`);
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
