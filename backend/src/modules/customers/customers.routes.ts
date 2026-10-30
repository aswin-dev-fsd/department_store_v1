import { lookupCustomerQuerySchema } from '@ds/shared';
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { customersController } from './customers.controller.js';

/**
 * /api/v1/customers — client-wide customers (D-08), so no branch is needed; permission bill:create
 * (cashiers at the counter)
 * - GET /lookup   the customer with ?phone= (any common format), or 404
 */
export function customersRoutes(deps: AppDeps): Router {
  const controller = customersController(deps);
  const router = Router();
  router.use(requireAuth(deps.db));
  router.get(
    '/lookup',
    requirePermission('bill:create'),
    validate({ query: lookupCustomerQuerySchema }),
    controller.lookup,
  );
  return router;
}
