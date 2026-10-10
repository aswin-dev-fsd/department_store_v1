import { updateSettingsSchema } from '@ds/shared';
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { settingsController } from './settings.controller.js';

/**
 * /api/v1/admin/settings — Admin only (permission admin:settings)
 * - GET /   the client settings
 * - PUT /   replace them
 */
export function settingsRoutes(deps: AppDeps): Router {
  const controller = settingsController(deps);
  const router = Router();
  router.use(requireAuth(deps.db), requirePermission('admin:settings'));
  router.get('/', controller.get);
  router.put('/', validate({ body: updateSettingsSchema }), controller.update);
  return router;
}
