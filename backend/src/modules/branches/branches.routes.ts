import {
  createBranchSchema,
  idParamSchema,
  listBranchesQuerySchema,
  updateBranchSchema,
} from '@ds/shared';
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { branchesController } from './branches.controller.js';

/**
 * /api/v1/admin/branches — Admin only (permission admin:branches)
 * - GET   /      list (?limit=20&offset=0&isActive=true|false)
 * - POST  /      create
 * - PATCH /:id   edit, or deactivate / reactivate with isActive
 */
export function branchesRoutes(deps: AppDeps): Router {
  const controller = branchesController(deps);
  const router = Router();
  router.use(requireAuth(deps.db), requirePermission('admin:branches'));
  router.get('/', validate({ query: listBranchesQuerySchema }), controller.list);
  router.post('/', validate({ body: createBranchSchema }), controller.create);
  router.patch(
    '/:id',
    validate({ params: idParamSchema, body: updateBranchSchema }),
    controller.update,
  );
  return router;
}
