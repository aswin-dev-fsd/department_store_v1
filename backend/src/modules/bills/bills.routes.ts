import {
  cancelBillSchema,
  createBillSchema,
  idParamSchema,
  listBillsQuerySchema,
} from '@ds/shared';
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireBranch, requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { billsController } from './bills.controller.js';

/**
 * /api/v1/bills — the active branch's bills (cashiers; not the Admin)
 * - POST /             save a bill: one transaction for the number, money and stock (bill:create)
 * - GET  /             find bills (?from=&to=&billNo=&phone=&cashierId=&status=&limit=&offset=)
 * - GET  /:id          one bill with its lines and payments (bill:read)
 * - GET  /:id/receipt  everything the receipt prints (bill:read)
 * - POST /:id/cancel   cancel with { reason }: stock back, number kept (bill:cancel)
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
  router.get(
    '/',
    requirePermission('bill:read'),
    requireBranch,
    validate({ query: listBillsQuerySchema }),
    controller.list,
  );
  router.get(
    '/:id',
    requirePermission('bill:read'),
    requireBranch,
    validate({ params: idParamSchema }),
    controller.get,
  );
  router.get(
    '/:id/receipt',
    requirePermission('bill:read'),
    requireBranch,
    validate({ params: idParamSchema }),
    controller.receipt,
  );
  router.post(
    '/:id/cancel',
    requirePermission('bill:cancel'),
    requireBranch,
    validate({ params: idParamSchema, body: cancelBillSchema }),
    controller.cancel,
  );
  return router;
}
