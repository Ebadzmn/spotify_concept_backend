import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/spotify_sync_rooms?schema=public'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().default('dev-super-secret-sync-room-jwt-key'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('*'),
  MAX_ROOM_MEMBERS: z.coerce.number().default(50),
  ROOM_IDLE_TTL: z.coerce.number().default(1800), // in seconds
  SYNC_INTERVAL_MS: z.coerce.number().default(5000),
  SCHEDULE_BUFFER_MS: z.coerce.number().default(1500),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(120),
});

export type Config = z.infer<typeof envSchema>;

export const config: Config = envSchema.parse(process.env);
