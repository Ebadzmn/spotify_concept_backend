import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import { config } from './config/index.js';
import { authRouter } from './routes/auth.routes.js';
import { roomRouter } from './routes/room.routes.js';
import { errorHandler } from './middleware/errorHandler.js';

const swaggerDocPath = path.join(process.cwd(), 'src', 'docs', 'swagger.yaml');

export function createApp(): Express {
  const app = express();

  // Basic Security & Headers
  app.use(helmet({
    contentSecurityPolicy: false, // For Swagger UI assets
  }));

  app.use(cors({
    origin: config.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  }));

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Global API Rate Limiter
  const limiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    max: config.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      code: 'RATE_LIMITED',
      message: 'Too many requests from this IP, please try again later.',
    },
  });
  app.use('/api/', limiter);

  // Swagger Documentation UI
  try {
    const swaggerDocument = YAML.load(swaggerDocPath);
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  } catch (e) {
    // In test or non-bundled environments
  }

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      serverTime: Date.now(),
      env: config.NODE_ENV,
    });
  });

  // REST API routes
  app.use('/api/auth', authRouter);
  app.use('/api/rooms', roomRouter);

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
