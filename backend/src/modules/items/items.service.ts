// Items (cashiers, per branch): create, edit, deactivate, search and look up. Every change is
// audited (D-30). Stock is never touched here beyond giving a new item its row at 0: quantities
// change only through the stock ledger (stock.service).
import type { DbOrTx, Db } from '@ds/database';
import {
  SELLING_ABOVE_MRP_MESSAGE,
  type CreateItemInput,
  type Item,
  type ListItemsQuery,
  type LookupItemQuery,
  type Page,
  type UpdateItemInput,
} from '@ds/shared';
import { logAudit } from '../../lib/audit.js';
import { changedFields } from '../../lib/changes.js';
import { isUniqueViolation } from '../../lib/db-errors.js';
import { AppError, NotFoundError, ValidationError } from '../../lib/errors.js';
import type { RequestContext } from '../../middleware/auth.js';
import * as model from './items.model.js';
import type { ItemChanges, ItemRow, ItemWithStock } from './items.model.js';

function toItem(row: ItemWithStock): Item {
  return {
    id: row.id,
    code: row.code,
    barcode: row.barcode,
    name: row.name,
    categoryId: row.categoryId,
    mrpPaise: row.mrpPaise,
    sellingPricePaise: row.sellingPricePaise,
    reorderLevel: row.reorderLevel,
    isActive: row.isActive,
    stock: row.stock,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The fields an edit may change: what the audit rows record. */
function editable(row: ItemRow): Required<ItemChanges> {
  return {
    code: row.code,
    barcode: row.barcode,
    name: row.name,
    categoryId: row.categoryId,
    mrpPaise: row.mrpPaise,
    sellingPricePaise: row.sellingPricePaise,
    reorderLevel: row.reorderLevel,
    isActive: row.isActive,
  };
}

function fieldProblem(path: string, message: string): ValidationError {
  return new ValidationError('Invalid request data', [{ path: `body.${path}`, message }]);
}

/** The category must be one of this branch's; a missing one or another branch's is a 422. */
async function requireCategory(
  db: DbOrTx,
  branchId: number,
  categoryId: number | null | undefined,
): Promise<void> {
  if (categoryId === null || categoryId === undefined) {
    return;
  }
  if (!(await model.categoryInBranch(db, branchId, categoryId))) {
    throw fieldProblem('categoryId', "Choose one of this branch's categories");
  }
}

/**
 * Work out which unique rule a failed write broke: the code if the branch has an item with the
 * code being written, otherwise the barcode (the only other unique rule). Called after the failed
 * transaction has rolled back, when the winning item is committed and visible.
 */
async function duplicateOf(db: Db, branchId: number, writtenCode: string | undefined) {
  if (writtenCode !== undefined && (await model.isCodeTaken(db, branchId, writtenCode))) {
    return new AppError('DUPLICATE_CODE', 'This branch already has an item with that code');
  }
  return new AppError('DUPLICATE_BARCODE', 'This branch already has an item with that barcode');
}

/** One page of the branch's items by name, with stock; active and inactive alike unless filtered. */
export async function listItems(
  db: Db,
  branchId: number,
  query: ListItemsQuery,
): Promise<Page<Item>> {
  const { rows, total } = await model.listItems(db, branchId, query);
  return { items: rows.map(toItem), total, limit: query.limit, offset: query.offset };
}

/** The branch's active item with exactly this barcode or code; anything else is a 404. */
export async function lookupItem(db: Db, branchId: number, query: LookupItemQuery): Promise<Item> {
  const row =
    query.barcode !== undefined
      ? await model.findActiveItemByBarcode(db, branchId, query.barcode)
      : query.code !== undefined
        ? await model.findActiveItemByCode(db, branchId, query.code)
        : undefined;
  if (!row) {
    throw new NotFoundError('Item not found');
  }
  return toItem(row);
}

/**
 * Create an item in the branch together with its stock row (quantity 0), in one transaction. A
 * code or barcode the branch already uses answers DUPLICATE_CODE / DUPLICATE_BARCODE.
 */
export async function createItem(
  db: Db,
  ctx: RequestContext,
  branchId: number,
  input: CreateItemInput,
  ip: string | null,
): Promise<Item> {
  await requireCategory(db, branchId, input.categoryId);
  try {
    return await db.transaction(async (tx) => {
      const row = await model.insertItem(tx, {
        branchId,
        code: input.code,
        barcode: input.barcode ?? null,
        name: input.name,
        categoryId: input.categoryId ?? null,
        mrpPaise: input.mrpPaise,
        sellingPricePaise: input.sellingPricePaise,
        reorderLevel: input.reorderLevel ?? null,
      });
      await model.insertStockRow(tx, row.id);
      await logAudit(tx, {
        actorId: ctx.user.id,
        branchId,
        action: 'item.create',
        entity: 'item',
        entityId: row.id,
        after: editable(row),
        ip,
      });
      return toItem({ ...row, stock: 0 });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw await duplicateOf(db, branchId, input.code);
    }
    throw error;
  }
}

/**
 * Edit an item of the branch, or deactivate / reactivate it with `isActive`. Only fields that
 * really change are written and audited (with the old and new values); a request that changes
 * nothing writes nothing. A selling price above the MRP is a 422, comparing a single new price
 * with the stored other one. An item of another branch is not found.
 */
export async function updateItem(
  db: Db,
  ctx: RequestContext,
  branchId: number,
  id: number,
  patch: UpdateItemInput,
  ip: string | null,
): Promise<Item> {
  let writtenCode: string | undefined;
  try {
    return await db.transaction(async (tx) => {
      const current = await model.findItemForUpdate(tx, branchId, id);
      if (!current) {
        throw new NotFoundError('Item not found');
      }
      await requireCategory(tx, branchId, patch.categoryId);
      const changes = changedFields(editable(current), patch);
      if (changes) {
        const mrpPaise = changes.after.mrpPaise ?? current.mrpPaise;
        const sellingPricePaise = changes.after.sellingPricePaise ?? current.sellingPricePaise;
        if (sellingPricePaise > mrpPaise) {
          throw changes.after.sellingPricePaise !== undefined
            ? fieldProblem('sellingPricePaise', SELLING_ABOVE_MRP_MESSAGE)
            : fieldProblem('mrpPaise', 'MRP cannot be below the selling price');
        }
        writtenCode = changes.after.code;
        await model.updateItem(tx, id, changes.after);
        await logAudit(tx, {
          actorId: ctx.user.id,
          branchId,
          action:
            changes.after.isActive === undefined
              ? 'item.update'
              : changes.after.isActive
                ? 'item.activate'
                : 'item.deactivate',
          entity: 'item',
          entityId: id,
          before: changes.before,
          after: changes.after,
          ip,
        });
      }
      const item = await model.findItemWithStock(tx, branchId, id);
      return toItem(item!);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw await duplicateOf(db, branchId, writtenCode);
    }
    throw error;
  }
}
