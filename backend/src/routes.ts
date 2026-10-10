import { Router } from 'express';
import type { AppDeps } from './deps.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { branchesRoutes } from './modules/branches/branches.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';

/** Every API route, mounted by createApp under /api/v1. */
export function apiRoutes(deps: AppDeps): Router {
  const router = Router();
  router.use('/health', healthRoutes(deps));
  router.use('/auth', authRoutes(deps));
  router.use('/admin/branches', branchesRoutes(deps));
  router.use('/admin/settings', settingsRoutes(deps));
  return router;
}
