import {
  createCategorySchema,
  idParamSchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
} from '@ds/shared';
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireBranch, requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { categoriesController } from './categories.controller.js';

/**
 * /api/v1/categories — the active branch's categories
 * - GET   /      list (?limit=20&offset=0), by name; permission stock:read
 * - POST  /      create; permission category:write (cashiers; not the Admin)
 * - PATCH /:id   rename; permission category:write
 * Every route needs a chosen branch (403 NO_ACTIVE_BRANCH), after the permission check.
 */
export function categoriesRoutes(deps: AppDeps): Router {
  const controller = categoriesController(deps);
  const router = Router();
  router.use(requireAuth(deps.db));
  router.get(
    '/',
    requirePermission('stock:read'),
    requireBranch,
    validate({ query: listCategoriesQuerySchema }),
    controller.list,
  );
  router.post(
    '/',
    requirePermission('category:write'),
    requireBranch,
    validate({ body: createCategorySchema }),
    controller.create,
  );
  router.patch(
    '/:id',
    requirePermission('category:write'),
    requireBranch,
    validate({ params: idParamSchema, body: updateCategorySchema }),
    controller.rename,
  );
  return router;
}
