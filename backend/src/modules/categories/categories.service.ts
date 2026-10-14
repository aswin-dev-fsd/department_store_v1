// Categories (cashiers, per branch): list, create, rename. Every change is audited (D-30).
import type { Db } from '@ds/database';
import type {
  Category,
  CreateCategoryInput,
  ListCategoriesQuery,
  Page,
  UpdateCategoryInput,
} from '@ds/shared';
import { logAudit } from '../../lib/audit.js';
import { changedFields } from '../../lib/changes.js';
import { isUniqueViolation } from '../../lib/db-errors.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import type { RequestContext } from '../../middleware/auth.js';
import * as model from './categories.model.js';
import type { CategoryRow } from './categories.model.js';

function duplicateName(): AppError {
  return new AppError('DUPLICATE_NAME', 'This branch already has a category with that name');
}

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** One page of the branch's categories, by name. */
export async function listCategories(
  db: Db,
  branchId: number,
  query: ListCategoriesQuery,
): Promise<Page<Category>> {
  const { rows, total } = await model.listCategories(db, branchId, query);
  return { items: rows.map(toCategory), total, limit: query.limit, offset: query.offset };
}

/** Create a category in the branch. A name the branch already uses (any case) answers DUPLICATE_NAME. */
export async function createCategory(
  db: Db,
  ctx: RequestContext,
  branchId: number,
  input: CreateCategoryInput,
  ip: string | null,
): Promise<Category> {
  return db.transaction(async (tx) => {
    const row = await model.insertCategoryIfNameFree(tx, branchId, input.name);
    if (!row) {
      throw duplicateName();
    }
    await logAudit(tx, {
      actorId: ctx.user.id,
      branchId,
      action: 'category.create',
      entity: 'category',
      entityId: row.id,
      after: { name: row.name },
      ip,
    });
    return toCategory(row);
  });
}

/**
 * Rename a category of the branch. A category of another branch is not found. Renaming to the
 * name it already has writes nothing; renaming to another category's name answers DUPLICATE_NAME.
 */
export async function renameCategory(
  db: Db,
  ctx: RequestContext,
  branchId: number,
  id: number,
  input: UpdateCategoryInput,
  ip: string | null,
): Promise<Category> {
  try {
    return await db.transaction(async (tx) => {
      const current = await model.findCategoryForUpdate(tx, branchId, id);
      if (!current) {
        throw new NotFoundError('Category not found');
      }
      const changes = changedFields({ name: current.name }, { name: input.name });
      if (!changes) {
        return toCategory(current);
      }
      const updated = await model.renameCategory(tx, id, input.name);
      await logAudit(tx, {
        actorId: ctx.user.id,
        branchId,
        action: 'category.update',
        entity: 'category',
        entityId: id,
        before: changes.before,
        after: changes.after,
        ip,
      });
      return toCategory(updated);
    });
  } catch (error) {
    // Only the (branch, lower(name)) index can be violated here: another category has that name
    if (isUniqueViolation(error)) {
      throw duplicateName();
    }
    throw error;
  }
}
