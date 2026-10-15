import { itemIdParamSchema, listMovementsQuerySchema, listStockQuerySchema } from '@ds/shared';
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { stockController } from './stock.controller.js';

/**
 * /api/v1/stock — current stock and the movement history; both routes need permission stock:read
 * - GET /                     the branch's items with their quantity (?categoryId=&limit=20&offset=0)
 * - GET /:itemId/movements    one item's ledger, newest first (?limit=20&offset=0)
 * A cashier reads the branch they work in (403 NO_ACTIVE_BRANCH before they choose one). The Admin,
 * who works in no branch, names it with ?branchId= (see the controller). Nothing here changes stock.
 */
export function stockRoutes(deps: AppDeps): Router {
  const controller = stockController(deps);
  const router = Router();
  router.use(requireAuth(deps.db));
  router.get(
    '/',
    requirePermission('stock:read'),
    validate({ query: listStockQuerySchema }),
    controller.list,
  );
  router.get(
    '/:itemId/movements',
    requirePermission('stock:read'),
    validate({ params: itemIdParamSchema, query: listMovementsQuerySchema }),
    controller.movements,
  );
  return router;
}
