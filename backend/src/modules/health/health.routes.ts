import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { healthController } from './health.controller.js';

/** GET /api/v1/health — liveness plus database reachability. Public: no login needed. */
export function healthRoutes(deps: AppDeps): Router {
  const controller = healthController(deps);
  const router = Router();
  router.get('/', controller.get);
  return router;
}
