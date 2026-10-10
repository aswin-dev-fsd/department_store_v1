import { Router } from 'express';
import type { AppDeps } from './deps.js';
import { healthRoutes } from './modules/health/health.routes.js';

/** Every API route, mounted by createApp under /api/v1. */
export function apiRoutes(deps: AppDeps): Router {
  const router = Router();
  router.use('/health', healthRoutes(deps));
  return router;
}
