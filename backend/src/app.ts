import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import type { AppDeps } from './deps.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { apiRoutes } from './routes.js';

export const API_PREFIX = '/api/v1';

/** Build the Express app (no `listen` — server.ts does that, tests use Supertest). */
export function createApp(deps: AppDeps): Express {
  const app = express();

  // First, so every request is logged — including ones rejected below
  app.use(
    pinoHttp({
      logger,
      // Render polls health constantly; keep it out of the logs
      autoLogging: { ignore: (req) => req.url === `${API_PREFIX}/health` },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.use(API_PREFIX, apiRoutes(deps));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
