import { idParamSchema } from '@ds/shared';
import express, { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { importController } from './import.controller.js';

/**
 * /api/v1/admin/branches/:id/import — Admin only (permission admin:import)
 * - POST /:id/import   the CSV file is the request body (Content-Type: text/csv, up to 5 MB):
 *                      201 with the counts, or 422 IMPORT_INVALID listing every problem
 * Mounted ahead of the branches routes on the same prefix, so it answers its own path with its own
 * permission and lets every other path fall through.
 */
export function importRoutes(deps: AppDeps): Router {
  const controller = importController(deps);
  const router = Router();
  router.post(
    '/:id/import',
    requireAuth(deps.db),
    requirePermission('admin:import'),
    validate({ params: idParamSchema }),
    // Read only after the caller is known to be allowed to send a file
    express.text({ type: 'text/csv', limit: '5mb' }),
    controller.importItems,
  );
  return router;
}
