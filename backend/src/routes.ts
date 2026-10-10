import { Router } from 'express';
import type { AppDeps } from './deps.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';

/** Every API route, mounted by createApp under /api/v1. */
export function apiRoutes(deps: AppDeps): Router {
  const router = Router();
  router.use('/health', healthRoutes(deps));
  router.use('/auth', authRoutes(deps));
  return router;
}
