import { changePasswordSchema, loginSchema, selectBranchSchema } from '@ds/shared';
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { authController } from './auth.controller.js';

/**
 * /api/v1/auth
 * - POST /login            public; sets the ds_session cookie
 * - GET  /me               logged in (allowed while a password change is due)
 * - POST /change-password  logged in (allowed while a password change is due)
 * - POST /logout           logged in (allowed while a password change is due)
 * - POST /select-branch    logged in; cashiers only
 */
export function authRoutes(deps: AppDeps): Router {
  const controller = authController(deps);
  const loggedIn = requireAuth(deps.db);
  const loggedInPendingChange = requireAuth(deps.db, { allowPendingPasswordChange: true });

  const router = Router();
  router.post('/login', validate({ body: loginSchema }), controller.login);
  router.get('/me', loggedInPendingChange, controller.me);
  router.post(
    '/change-password',
    loggedInPendingChange,
    validate({ body: changePasswordSchema }),
    controller.changePassword,
  );
  router.post('/logout', loggedInPendingChange, controller.logout);
  router.post(
    '/select-branch',
    loggedIn,
    validate({ body: selectBranchSchema }),
    controller.selectBranch,
  );
  return router;
}
