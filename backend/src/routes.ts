import { Router } from 'express';
import type { AppDeps } from './deps.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { branchesRoutes } from './modules/branches/branches.routes.js';
import { categoriesRoutes } from './modules/categories/categories.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { itemsRoutes } from './modules/items/items.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';

/** Every API route, mounted by createApp under /api/v1. */
export function apiRoutes(deps: AppDeps): Router {
  const router = Router();
  router.use('/health', healthRoutes(deps));
  router.use('/auth', authRoutes(deps));
  router.use('/admin/branches', branchesRoutes(deps));
  router.use('/admin/settings', settingsRoutes(deps));
  router.use('/admin/users', usersRoutes(deps));
  router.use('/categories', categoriesRoutes(deps));
  router.use('/items', itemsRoutes(deps));
  return router;
}
