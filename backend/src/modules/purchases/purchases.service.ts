// Purchases (cashiers, per branch; D-19): draft purchases are created, edited, listed and viewed
// here, and posted into stock. A draft never touches stock: only posting does, through the stock
// ledger. Every change is audited (D-30).
import type { Db, DbOrTx } from '@ds/database';
import {
  SELLING_ABOVE_MRP_MESSAGE,
  type ListPurchasesQuery,
  type Page,
  type Purchase,
  type PurchaseDraftInput,
  type PurchaseSummary,
} from '@ds/shared';
import { logAudit } from '../../lib/audit.js';
import { changedFields } from '../../lib/changes.js';
import { isUniqueViolation } from '../../lib/db-errors.js';
import { AppError, NotFoundError, ValidationError } from '../../lib/errors.js';
import type { RequestContext } from '../../middleware/auth.js';
import { postMovements } from '../stock/stock.service.js';
import * as model from './purchases.model.js';
import type {
  PurchaseChanges,
  PurchaseDetailRow,
  PurchaseLineRow,
  PurchaseRow,
  PurchaseSummaryRow,
} from './purchases.model.js';

/** A line as stored and audited: what the client sent plus the line total the server computed. */
interface LineValues {
  itemId: number;
  quantity: number;
  costPricePaise: number;
  newMrpPaise: number | null;
  newSellingPricePaise: number | null;
  lineTotalPaise: number;
}

function toSummary(row: PurchaseSummaryRow): PurchaseSummary {
  return {
    id: row.id,
    vendor: { id: row.vendorId, name: row.vendorName },
    vendorInvoiceNo: row.vendorInvoiceNo,
    invoiceDate: row.invoiceDate,
    status: row.status,
    totalPaise: row.totalPaise,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPurchase(row: PurchaseDetailRow, lines: PurchaseLineRow[]): Purchase {
  return {
    ...toSummary(row),
    notes: row.notes,
    createdBy: { id: row.createdBy, fullName: row.createdByName },
    postedBy:
      row.postedBy === null ? null : { id: row.postedBy, fullName: row.postedByName ?? '' },
    postedAt: row.postedAt?.toISOString() ?? null,
    cancelledBy:
      row.cancelledBy === null
        ? null
        : { id: row.cancelledBy, fullName: row.cancelledByName ?? '' },
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    lines: lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      itemCode: line.itemCode,
      itemName: line.itemName,
      quantity: line.quantity,
      costPricePaise: line.costPricePaise,
      newMrpPaise: line.newMrpPaise,
      newSellingPricePaise: line.newSellingPricePaise,
      lineTotalPaise: line.lineTotalPaise,
    })),
  };
}

/** The header fields a draft edit may change: what the audit rows record. */
function header(row: PurchaseRow): Required<PurchaseChanges> {
  return {
    vendorId: row.vendorId,
    vendorInvoiceNo: row.vendorInvoiceNo,
    invoiceDate: row.invoiceDate,
    notes: row.notes,
    totalPaise: row.totalPaise,
  };
}

/** The lines to store, with each line total computed here; the client never sends totals. */
function lineValues(input: PurchaseDraftInput): LineValues[] {
  return input.lines.map((line) => ({
    itemId: line.itemId,
    quantity: line.quantity,
    costPricePaise: line.costPricePaise,
    newMrpPaise: line.newMrpPaise ?? null,
    newSellingPricePaise: line.newSellingPricePaise ?? null,
    lineTotalPaise: line.quantity * line.costPricePaise,
  }));
}

/** The header to store: the whole draft is replaced, so a field left out is cleared. */
function headerValues(input: PurchaseDraftInput, lines: LineValues[]): Required<PurchaseChanges> {
  return {
    vendorId: input.vendorId,
    vendorInvoiceNo: input.vendorInvoiceNo,
    invoiceDate: input.invoiceDate,
    notes: input.notes ?? null,
    totalPaise: lines.reduce((total, line) => total + line.lineTotalPaise, 0),
  };
}

function storedLineValues(rows: PurchaseLineRow[]): LineValues[] {
  return rows.map((row) => ({
    itemId: row.itemId,
    quantity: row.quantity,
    costPricePaise: row.costPricePaise,
    newMrpPaise: row.newMrpPaise,
    newSellingPricePaise: row.newSellingPricePaise,
    lineTotalPaise: row.lineTotalPaise,
  }));
}

/** Whether two sets of lines are the same, line by line and in the same order. */
function sameLines(a: LineValues[], b: LineValues[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The vendor and every item must be active and belong to the branch; anything else is a 422
 * naming each field at fault (`body.vendorId`, `body.lines.2.itemId`), and nothing is saved.
 */
async function requireActiveReferences(
  db: DbOrTx,
  branchId: number,
  input: PurchaseDraftInput,
): Promise<void> {
  const details: { path: string; message: string }[] = [];
  if (!(await model.activeVendorInBranch(db, branchId, input.vendorId))) {
    details.push({ path: 'body.vendorId', message: "Choose one of this branch's active vendors" });
  }
  const itemIds = [...new Set(input.lines.map((line) => line.itemId))];
  const active = await model.activeItemIdsInBranch(db, branchId, itemIds);
  input.lines.forEach((line, index) => {
    if (!active.has(line.itemId)) {
      details.push({
        path: `body.lines.${index}.itemId`,
        message: "Choose one of this branch's active items",
      });
    }
  });
  if (details.length > 0) {
    throw new ValidationError('Invalid request data', details);
  }
}

function duplicateInvoice(): AppError {
  return new AppError(
    'DUPLICATE_INVOICE',
    'This vendor invoice has already been entered in this branch',
  );
}

function documentLocked(status: string, action: 'edited' | 'posted'): AppError {
  return new AppError(
    'DOCUMENT_LOCKED',
    `This purchase is ${status} and can no longer be ${action}`,
  );
}

async function loadPurchase(db: DbOrTx, branchId: number, id: number): Promise<Purchase> {
  const row = await model.findPurchase(db, branchId, id);
  if (!row) {
    throw new NotFoundError('Purchase not found');
  }
  return toPurchase(row, await model.findLines(db, id));
}

/** One page of the branch's purchases, newest invoice date first, filtered as asked. */
export async function listPurchases(
  db: Db,
  branchId: number,
  query: ListPurchasesQuery,
): Promise<Page<PurchaseSummary>> {
  const { rows, total } = await model.listPurchases(db, branchId, query);
  return { items: rows.map(toSummary), total, limit: query.limit, offset: query.offset };
}

/** A purchase of the branch with its lines; another branch's is not found. */
export async function getPurchase(db: Db, branchId: number, id: number): Promise<Purchase> {
  return loadPurchase(db, branchId, id);
}

/**
 * Create a draft purchase in the branch with zero or more lines. The server computes every line
 * total and the purchase total (Σ quantity × cost price). The same vendor invoice already entered
 * in the branch, in any letter case and not cancelled, answers DUPLICATE_INVOICE. Stock is not
 * touched.
 */
export async function createPurchase(
  db: Db,
  ctx: RequestContext,
  branchId: number,
  input: PurchaseDraftInput,
  ip: string | null,
): Promise<Purchase> {
  try {
    return await db.transaction(async (tx) => {
      await requireActiveReferences(tx, branchId, input);
      const lines = lineValues(input);
      const values = headerValues(input, lines);
      const row = await model.insertPurchase(tx, {
        ...values,
        branchId,
        status: 'draft',
        createdBy: ctx.user.id,
      });
      await model.insertLines(
        tx,
        lines.map((line) => ({ ...line, purchaseId: row.id })),
      );
      await logAudit(tx, {
        actorId: ctx.user.id,
        branchId,
        action: 'purchase.create',
        entity: 'purchase',
        entityId: row.id,
        after: { ...values, status: row.status, lines },
        ip,
      });
      return loadPurchase(tx, branchId, row.id);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw duplicateInvoice();
    }
    throw error;
  }
}

/**
 * Replace a draft's header and all its lines, recomputing the totals. Only a draft can be edited:
 * a posted or cancelled purchase answers DOCUMENT_LOCKED. Only what really changes is written and
 * audited (the changed header fields, and the lines when they differ); an edit that changes
 * nothing writes nothing. Another branch's purchase is not found. Stock is not touched.
 */
export async function updatePurchase(
  db: Db,
  ctx: RequestContext,
  branchId: number,
  id: number,
  input: PurchaseDraftInput,
  ip: string | null,
): Promise<Purchase> {
  try {
    return await db.transaction(async (tx) => {
      const current = await model.findPurchaseForUpdate(tx, branchId, id);
      if (!current) {
        throw new NotFoundError('Purchase not found');
      }
      if (current.status !== 'draft') {
        throw documentLocked(current.status, 'edited');
      }
      await requireActiveReferences(tx, branchId, input);

      const lines = lineValues(input);
      const before = storedLineValues(await model.findLines(tx, id));
      const linesChanged = !sameLines(before, lines);
      const changes = changedFields(header(current), headerValues(input, lines));
      if (!changes && !linesChanged) {
        return loadPurchase(tx, branchId, id);
      }

      await model.updatePurchase(tx, id, changes?.after ?? {});
      if (linesChanged) {
        await model.deleteLines(tx, id);
        await model.insertLines(
          tx,
          lines.map((line) => ({ ...line, purchaseId: id })),
        );
      }
      await logAudit(tx, {
        actorId: ctx.user.id,
        branchId,
        action: 'purchase.update',
        entity: 'purchase',
        entityId: id,
        before: { ...changes?.before, ...(linesChanged ? { lines: before } : {}) },
        after: { ...changes?.after, ...(linesChanged ? { lines } : {}) },
        ip,
      });
      return loadPurchase(tx, branchId, id);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw duplicateInvoice();
    }
    throw error;
  }
}

/**
 * Post a draft, all in one transaction: lock the purchase and check it is still a draft (so of two
 * parallel posts exactly one succeeds, and the other answers DOCUMENT_LOCKED), add every line's
 * quantity to stock through the ledger (`purchase` movements), apply the lines' new prices to the
 * items (an audit row per item changed), then mark it posted. A draft with no lines answers
 * EMPTY_PURCHASE. A new selling price above the MRP the item would then have is a 422, and nothing
 * is saved. When two lines of one item give new prices, the later line wins.
 */
export async function postPurchase(
  db: Db,
  ctx: RequestContext,
  branchId: number,
  id: number,
  ip: string | null,
): Promise<Purchase> {
  return db.transaction(async (tx) => {
    const current = await model.findPurchaseForUpdate(tx, branchId, id);
    if (!current) {
      throw new NotFoundError('Purchase not found');
    }
    if (current.status !== 'draft') {
      throw documentLocked(current.status, 'posted');
    }
    const lines = await model.findLines(tx, id);
    if (lines.length === 0) {
      throw new AppError('EMPTY_PURCHASE', 'Add at least one line before posting this purchase');
    }

    await postMovements(tx, {
      branchId,
      userId: ctx.user.id,
      movements: lines.map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity,
        type: 'purchase',
        refType: 'purchase',
        refId: id,
      })),
    });

    // The prices each item ends up with, line by line, remembering which line set the selling price
    const priced = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.newMrpPaise !== null || line.newSellingPricePaise !== null);
    const locked = await model.lockItemPrices(tx, branchId, [
      ...new Set(priced.map(({ line }) => line.itemId)),
    ]);
    const next = new Map(
      locked.map((item) => [
        item.id,
        {
          current: item,
          mrpPaise: item.mrpPaise,
          sellingPricePaise: item.sellingPricePaise,
          index: 0,
        },
      ]),
    );
    for (const { line, index } of priced) {
      const target = next.get(line.itemId)!;
      target.mrpPaise = line.newMrpPaise ?? target.mrpPaise;
      target.sellingPricePaise = line.newSellingPricePaise ?? target.sellingPricePaise;
      target.index = index;
    }
    const problems = [...next.values()]
      .filter((target) => target.sellingPricePaise > target.mrpPaise)
      .map((target) => ({
        path: `lines.${target.index}.newSellingPricePaise`,
        message: SELLING_ABOVE_MRP_MESSAGE,
      }));
    if (problems.length > 0) {
      throw new ValidationError('Invalid request data', problems);
    }
    for (const target of next.values()) {
      const changes = changedFields(
        { mrpPaise: target.current.mrpPaise, sellingPricePaise: target.current.sellingPricePaise },
        { mrpPaise: target.mrpPaise, sellingPricePaise: target.sellingPricePaise },
      );
      if (!changes) continue;
      await model.updateItemPrices(tx, target.current.id, changes.after);
      await logAudit(tx, {
        actorId: ctx.user.id,
        branchId,
        action: 'item.update',
        entity: 'item',
        entityId: target.current.id,
        before: changes.before,
        after: { ...changes.after, purchaseId: id },
        ip,
      });
    }

    await model.markPosted(tx, id, ctx.user.id);
    await logAudit(tx, {
      actorId: ctx.user.id,
      branchId,
      action: 'purchase.post',
      entity: 'purchase',
      entityId: id,
      before: { status: 'draft' },
      after: { status: 'posted', totalPaise: current.totalPaise, lineCount: lines.length },
      ip,
    });
    return loadPurchase(tx, branchId, id);
  });
}
