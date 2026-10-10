// Branch management (Admin): create, list, edit, deactivate. Every change is audited (D-30).
import type { Db } from '@ds/database';
import type {
  Branch,
  CreateBranchInput,
  ListBranchesQuery,
  Page,
  UpdateBranchInput,
} from '@ds/shared';
import { logAudit } from '../../lib/audit.js';
import { changedFields } from '../../lib/changes.js';
import { isUniqueViolation } from '../../lib/db-errors.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import type { RequestContext } from '../../middleware/auth.js';
import * as model from './branches.model.js';
import type { BranchChanges, BranchRow } from './branches.model.js';

function duplicateCode(): AppError {
  return new AppError('DUPLICATE_CODE', 'Another branch already uses this code');
}

function toBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    address: row.address,
    phone: row.phone,
    billFooter: row.billFooter,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The editable fields of a branch: what audit rows and change detection look at. */
function editable(row: BranchRow) {
  return {
    code: row.code,
    name: row.name,
    address: row.address,
    phone: row.phone,
    billFooter: row.billFooter,
    isActive: row.isActive,
  };
}

/** Create a branch. A code that is already used answers DUPLICATE_CODE. */
export async function createBranch(
  db: Db,
  ctx: RequestContext,
  input: CreateBranchInput,
  ip: string | null,
): Promise<Branch> {
  return db.transaction(async (tx) => {
    const row = await model.insertBranchIfCodeFree(tx, {
      code: input.code,
      name: input.name,
      address: input.address,
      phone: input.phone ?? null,
      billFooter: input.billFooter ?? null,
    });
    if (!row) {
      throw duplicateCode();
    }
    await logAudit(tx, {
      actorId: ctx.user.id,
      branchId: row.id,
      action: 'branch.create',
      entity: 'branch',
      entityId: row.id,
      after: editable(row),
      ip,
    });
    return toBranch(row);
  });
}

/** One page of branches, active and inactive alike unless filtered. */
export async function listBranches(db: Db, query: ListBranchesQuery): Promise<Page<Branch>> {
  const { rows, total } = await model.listBranches(db, query);
  return { items: rows.map(toBranch), total, limit: query.limit, offset: query.offset };
}

/**
 * Edit a branch, or deactivate / reactivate it with `isActive`. Only fields that really change
 * are written and audited; a request that changes nothing writes nothing. Deactivating takes the
 * branch away from cashiers working in it at once (their next request no longer sees it).
 */
export async function updateBranch(
  db: Db,
  ctx: RequestContext,
  id: number,
  patch: UpdateBranchInput,
  ip: string | null,
): Promise<Branch> {
  try {
    return await db.transaction(async (tx) => {
      const current = await model.findBranchForUpdate(tx, id);
      if (!current) {
        throw new NotFoundError('Branch not found');
      }
      const changes = changedFields(editable(current), patch as BranchChanges);
      if (!changes) {
        return toBranch(current);
      }
      // TODO(5.6): once the branch has bills, its code is fixed (answer CODE_LOCKED here)
      const updated = await model.updateBranch(tx, id, changes.after);
      const statusChange =
        changes.after.isActive === undefined
          ? 'branch.update'
          : changes.after.isActive
            ? 'branch.activate'
            : 'branch.deactivate';
      await logAudit(tx, {
        actorId: ctx.user.id,
        branchId: id,
        action: statusChange,
        entity: 'branch',
        entityId: id,
        before: changes.before,
        after: changes.after,
        ip,
      });
      return toBranch(updated);
    });
  } catch (error) {
    // Only the code column is unique, so this is a code another branch already holds
    if (isUniqueViolation(error)) {
      throw duplicateCode();
    }
    throw error;
  }
}
