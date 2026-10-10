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
const HEALTH_PATHS = new Set([`${API_PREFIX}/health`, `${API_PREFIX}/health/live`]);

export interface AppSettings {
  /** Reverse-proxy hops to trust for req.ip (default: env TRUST_PROXY). */
  trustProxy?: number;
}

/** Build the Express app (no `listen` — server.ts does that, tests use Supertest). */
export function createApp(
  deps: AppDeps,
  { trustProxy = env.TRUST_PROXY }: AppSettings = {},
): Express {
  const app = express();
  // Behind Vercel + Render, req.ip must come from X-Forwarded-For, not the proxy's socket
  app.set('trust proxy', trustProxy);

  // First, so every request is logged — including ones rejected below
  app.use(
    pinoHttp({
      logger,
      // Render and keep-awake pings poll health constantly; keep them out of the logs
      autoLogging: { ignore: (req) => HEALTH_PATHS.has(req.url ?? '') },
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
