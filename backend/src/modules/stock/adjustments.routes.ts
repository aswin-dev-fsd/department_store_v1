import { createAdjustmentSchema } from '@ds/shared';
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireBranch, requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { adjustmentsController } from './adjustments.controller.js';

/**
 * /api/v1/stock/adjustments — stock corrections in the active branch (cashiers; not the Admin)
 * - POST /   { itemId, quantity (±packs), reason, note? } → 201 with the stock before and after
 *            (stock:adjust). Needs a chosen branch (403 NO_ACTIVE_BRANCH), after the permission check.
 */
export function adjustmentsRoutes(deps: AppDeps): Router {
  const controller = adjustmentsController(deps);
  const router = Router();
  router.use(requireAuth(deps.db));
  router.post(
    '/',
    requirePermission('stock:adjust'),
    requireBranch,
    validate({ body: createAdjustmentSchema }),
    controller.create,
  );
  return router;
}
