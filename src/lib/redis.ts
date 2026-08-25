import { Redis } from 'ioredis';
import { config } from '../config/index.js';
import { logger } from './logger.js';

let redisInstance: Redis | null = null;
let redisPubInstance: Redis | null = null;
let redisSubInstance: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisInstance) {
    redisInstance = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    redisInstance.on('connect', () => {
      logger.info('Redis connected successfully');
    });

    redisInstance.on('error', (err) => {
      logger.error({ err }, 'Redis connection error');
    });
  }
  return redisInstance;
}

export function getRedisPubClient(): Redis {
  if (!redisPubInstance) {
    redisPubInstance = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });

    redisPubInstance.on('connect', () => {
      logger.info('Redis Pub client connected successfully');
    });

    redisPubInstance.on('error', (err) => {
      logger.error({ err }, 'Redis Pub client connection error');
    });
  }
  return redisPubInstance;
}

export function getRedisSubClient(): Redis {
  if (!redisSubInstance) {
    redisSubInstance = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });

    redisSubInstance.on('connect', () => {
      logger.info('Redis Sub client connected successfully');
    });

    redisSubInstance.on('error', (err) => {
      logger.error({ err }, 'Redis Sub client connection error');
    });
  }
  return redisSubInstance;
}

export function setCustomRedisClient(client: Redis) {
  redisInstance = client;
  redisPubInstance = client;
  redisSubInstance = client;
}
