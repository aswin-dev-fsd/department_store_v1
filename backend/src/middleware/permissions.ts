import { can, type Permission } from '@ds/shared';
import type { RequestHandler } from 'express';
import { activeBranchId } from '../lib/branch-scope.js';
import { ForbiddenError } from '../lib/errors.js';
import { requestContext } from './auth.js';

/** Allow only roles granted `permission` (shared/permissions.ts); 403 otherwise. Needs requireAuth. */
export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    const { user } = requestContext(req);
    if (!can(user.role, permission)) {
      throw new ForbiddenError();
    }
    next();
  };
}

/** Require a usable active branch (cashier screens); 403 NO_ACTIVE_BRANCH otherwise. */
export const requireBranch: RequestHandler = (req, _res, next) => {
  activeBranchId(req);
  next();
};
