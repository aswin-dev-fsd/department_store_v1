import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { healthController } from './health.controller.js';

/**
 * Public, no login needed:
 * - GET /api/v1/health       — liveness plus database reachability (status page)
 * - GET /api/v1/health/live  — liveness only; for Render's health check and keep-awake pings
 */
export function healthRoutes(deps: AppDeps): Router {
  const controller = healthController(deps);
  const router = Router();
  router.get('/', controller.get);
  router.get('/live', controller.live);
  return router;
}
