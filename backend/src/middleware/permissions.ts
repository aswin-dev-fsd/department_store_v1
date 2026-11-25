import { can, type Permission } from '@ds/shared';
import type { RequestHandler } from 'express';
import { activeBranchId } from '../lib/branch-scope.js';
import { ForbiddenError } from '../lib/errors.js';
import { requestContext } from './auth.js';

// Each handler requirePermission makes, and the permission it checks (read by the security test)
const permissionChecks = new WeakMap<object, Permission>();

/** Allow only roles granted `permission` (shared/permissions.ts); 403 otherwise. Needs requireAuth. */
export function requirePermission(permission: Permission): RequestHandler {
  const handler: RequestHandler = (req, _res, next) => {
    const { user } = requestContext(req);
    if (!can(user.role, permission)) {
      throw new ForbiddenError();
    }
    next();
  };
  permissionChecks.set(handler, permission);
  return handler;
}

/** The permission a route handler checks, if it is one made by requirePermission. */
export function permissionCheckedBy(handler: unknown): Permission | undefined {
  return typeof handler === 'function' ? permissionChecks.get(handler) : undefined;
}

/** Require a usable active branch (cashier screens); 403 NO_ACTIVE_BRANCH otherwise. */
export const requireBranch: RequestHandler = (req, _res, next) => {
  activeBranchId(req);
  next();
};
