import {
  createItemSchema,
  idParamSchema,
  listItemsQuerySchema,
  lookupItemQuerySchema,
  updateItemSchema,
} from '@ds/shared';
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireBranch, requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { itemsController } from './items.controller.js';

/**
 * /api/v1/items — the active branch's items
 * - GET   /         search and list (?search=&categoryId=&active=&limit=20&offset=0), by name,
 *                   with stock; permission stock:read
 * - GET   /lookup   exact match of ?barcode= or ?code= among active items, else 404; permission
 *                   bill:create (the counter)
 * - POST  /         create (also creates its stock row at 0); permission item:write (cashiers; not the Admin)
 * - PATCH /:id      edit, or deactivate / reactivate with isActive; permission item:write
 * Every route needs a chosen branch (403 NO_ACTIVE_BRANCH), after the permission check.
 */
export function itemsRoutes(deps: AppDeps): Router {
  const controller = itemsController(deps);
  const router = Router();
  router.use(requireAuth(deps.db));
  router.get(
    '/',
    requirePermission('stock:read'),
    requireBranch,
    validate({ query: listItemsQuerySchema }),
    controller.list,
  );
  router.get(
    '/lookup',
    requirePermission('bill:create'),
    requireBranch,
    validate({ query: lookupItemQuerySchema }),
    controller.lookup,
  );
  router.post(
    '/',
    requirePermission('item:write'),
    requireBranch,
    validate({ body: createItemSchema }),
    controller.create,
  );
  router.patch(
    '/:id',
    requirePermission('item:write'),
    requireBranch,
    validate({ params: idParamSchema, body: updateItemSchema }),
    controller.update,
  );
  return router;
}
