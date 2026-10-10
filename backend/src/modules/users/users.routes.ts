import {
  createUserSchema,
  idParamSchema,
  listUsersQuerySchema,
  setUserBranchesSchema,
  updateUserSchema,
} from '@ds/shared';
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { usersController } from './users.controller.js';

/**
 * /api/v1/admin/users — Admin only (permission admin:users)
 * - GET   /                      list (?limit=20&offset=0&role=&isActive=)
 * - POST  /                      create; answers the one-time temporary password
 * - PATCH /:id                   edit the name, or deactivate / reactivate with isActive
 * - POST  /:id/reset-password    new one-time temporary password; ends the user's sessions
 * - PUT   /:id/branches          replace a cashier's list of branches
 */
export function usersRoutes(deps: AppDeps): Router {
  const controller = usersController(deps);
  const router = Router();
  router.use(requireAuth(deps.db), requirePermission('admin:users'));
  router.get('/', validate({ query: listUsersQuerySchema }), controller.list);
  router.post('/', validate({ body: createUserSchema }), controller.create);
  router.patch(
    '/:id',
    validate({ params: idParamSchema, body: updateUserSchema }),
    controller.update,
  );
  router.post('/:id/reset-password', validate({ params: idParamSchema }), controller.resetPassword);
  router.put(
    '/:id/branches',
    validate({ params: idParamSchema, body: setUserBranchesSchema }),
    controller.setBranches,
  );
  return router;
}
