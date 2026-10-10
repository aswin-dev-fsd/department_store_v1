import type { Request } from 'express';
import { requestContext } from '../middleware/auth.js';
import { ForbiddenError } from './errors.js';

/**
 * The branch this request works in: the session's active branch (AGENTS.md → Branch-scoped
 * data). Every query on branch-owned data filters by it, for example:
 *
 *   db.select().from(items)
 *     .where(and(eq(items.branchId, activeBranchId(req)), eq(items.id, itemId)))
 *
 * A record from another branch then simply isn't found (404), never leaked.
 * Throws ForbiddenError NO_ACTIVE_BRANCH when the session has no usable branch.
 */
export function activeBranchId(req: Request): number {
  const { activeBranchId: branchId } = requestContext(req);
  if (branchId === null) {
    throw new ForbiddenError('Choose a branch to work in first', 'NO_ACTIVE_BRANCH');
  }
  return branchId;
}
