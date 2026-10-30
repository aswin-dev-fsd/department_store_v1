import { idParamSchema, listPurchasesQuerySchema, purchaseDraftSchema } from '@ds/shared';
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireBranch, requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { purchasesController } from './purchases.controller.js';

/**
 * /api/v1/purchases — the active branch's purchases (cashiers; not the Admin). Reading and drafts
 * need permission purchase:write; posting needs purchase:post.
 * - GET  /      list (?status=&vendorId=&from=&to=&limit=20&offset=0), newest invoice date first
 * - GET  /:id   one purchase with its lines
 * - POST /      create a draft
 * - PUT  /:id   replace a draft's header and all its lines (400 DOCUMENT_LOCKED once posted)
 * - POST /:id/post  post a draft: stock in, new prices applied, locked
 * Every route needs a chosen branch (403 NO_ACTIVE_BRANCH), after the permission check.
 */
export function purchasesRoutes(deps: AppDeps): Router {
  const controller = purchasesController(deps);
  const router = Router();
  router.use(requireAuth(deps.db));
  router.get(
    '/',
    requirePermission('purchase:write'),
    requireBranch,
    validate({ query: listPurchasesQuerySchema }),
    controller.list,
  );
  router.get(
    '/:id',
    requirePermission('purchase:write'),
    requireBranch,
    validate({ params: idParamSchema }),
    controller.get,
  );
  router.post(
    '/',
    requirePermission('purchase:write'),
    requireBranch,
    validate({ body: purchaseDraftSchema }),
    controller.create,
  );
  router.put(
    '/:id',
    requirePermission('purchase:write'),
    requireBranch,
    validate({ params: idParamSchema, body: purchaseDraftSchema }),
    controller.update,
  );
  router.post(
    '/:id/post',
    requirePermission('purchase:post'),
    requireBranch,
    validate({ params: idParamSchema }),
    controller.post,
  );
  return router;
}
