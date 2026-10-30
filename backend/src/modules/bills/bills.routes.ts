import { createBillSchema } from '@ds/shared';
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireBranch, requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { billsController } from './bills.controller.js';

/**
 * /api/v1/bills — the active branch's bills (cashiers; not the Admin)
 * - POST /   save a bill: one transaction for the number, the money and the stock (bill:create)
 * Every route needs a chosen branch (403 NO_ACTIVE_BRANCH), after the permission check.
 */
export function billsRoutes(deps: AppDeps): Router {
  const controller = billsController(deps);
  const router = Router();
  router.use(requireAuth(deps.db));
  router.post(
    '/',
    requirePermission('bill:create'),
    requireBranch,
    validate({ body: createBillSchema }),
    controller.create,
  );
  return router;
}
