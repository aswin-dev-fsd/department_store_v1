import {
  createVendorSchema,
  idParamSchema,
  listVendorsQuerySchema,
  updateVendorSchema,
} from '@ds/shared';
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireBranch, requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { vendorsController } from './vendors.controller.js';

/**
 * /api/v1/vendors — the active branch's vendors; every route needs permission vendor:write
 * (cashiers; not the Admin)
 * - GET   /      search and list (?search=&active=&limit=20&offset=0), by name
 * - POST  /      create
 * - PATCH /:id   edit, or deactivate / reactivate with isActive
 * Every route needs a chosen branch (403 NO_ACTIVE_BRANCH), after the permission check.
 */
export function vendorsRoutes(deps: AppDeps): Router {
  const controller = vendorsController(deps);
  const router = Router();
  router.use(requireAuth(deps.db));
  router.get(
    '/',
    requirePermission('vendor:write'),
    requireBranch,
    validate({ query: listVendorsQuerySchema }),
    controller.list,
  );
  router.post(
    '/',
    requirePermission('vendor:write'),
    requireBranch,
    validate({ body: createVendorSchema }),
    controller.create,
  );
  router.patch(
    '/:id',
    requirePermission('vendor:write'),
    requireBranch,
    validate({ params: idParamSchema, body: updateVendorSchema }),
    controller.update,
  );
  return router;
}
