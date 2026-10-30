// Database queries for purchases — no business rules here (DreamLand §4). Every function that
// reads a purchase takes the branch: purchases are branch-owned, so another branch's is not found.
import { schema, type DbOrTx } from '@ds/database';
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

const { items, purchaseLines, purchases, users, vendors } = schema;

export type PurchaseRow = typeof purchases.$inferSelect;
export type NewPurchaseRow = typeof purchases.$inferInsert;
export type NewPurchaseLineRow = typeof purchaseLines.$inferInsert;
/** The header fields a draft edit may change. */
export type PurchaseChanges = Partial<
  Pick<PurchaseRow, 'vendorId' | 'vendorInvoiceNo' | 'invoiceDate' | 'notes' | 'totalPaise'>
>;

/** A purchase header with its vendor's name, for lists. */
export type PurchaseSummaryRow = Pick<
  PurchaseRow,
  | 'id'
  | 'vendorId'
  | 'vendorInvoiceNo'
  | 'invoiceDate'
  | 'status'
  | 'totalPaise'
  | 'createdAt'
  | 'updatedAt'
> & { vendorName: string };

/** A purchase header with the names of its vendor and of who created, posted and cancelled it. */
export type PurchaseDetailRow = PurchaseRow & {
  vendorName: string;
  createdByName: string;
  postedByName: string | null;
  cancelledByName: string | null;
};

/** A line with its item's code and name. */
export type PurchaseLineRow = typeof purchaseLines.$inferSelect & {
  itemCode: string;
  itemName: string;
};

const summaryColumns = {
  id: purchases.id,
  vendorId: purchases.vendorId,
  vendorName: vendors.name,
  vendorInvoiceNo: purchases.vendorInvoiceNo,
  invoiceDate: purchases.invoiceDate,
  status: purchases.status,
  totalPaise: purchases.totalPaise,
  createdAt: purchases.createdAt,
  updatedAt: purchases.updatedAt,
};

/**
 * Insert a purchase header and return the new row. The same vendor invoice already entered in the
 * branch (not cancelled) raises a unique violation.
 */
export async function insertPurchase(db: DbOrTx, values: NewPurchaseRow): Promise<PurchaseRow> {
  const [row] = await db.insert(purchases).values(values).returning();
  return row!;
}

/** Insert a purchase's lines, in the order given. */
export async function insertLines(db: DbOrTx, rows: NewPurchaseLineRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(purchaseLines).values(rows);
}

/** Remove every line of a purchase (a draft edit then inserts the new ones). */
export async function deleteLines(db: DbOrTx, purchaseId: number): Promise<void> {
  await db.delete(purchaseLines).where(eq(purchaseLines.purchaseId, purchaseId));
}

/** Load a purchase of this branch and lock its row until the transaction ends. */
export async function findPurchaseForUpdate(
  db: DbOrTx,
  branchId: number,
  id: number,
): Promise<PurchaseRow | undefined> {
  const [row] = await db
    .select()
    .from(purchases)
    .where(and(eq(purchases.id, id), eq(purchases.branchId, branchId)))
    .limit(1)
    .for('update');
  return row;
}

/**
 * Change header fields of a purchase and refresh its `updated_at`. A unique violation means the
 * new vendor invoice is already entered in the branch.
 */
export async function updatePurchase(
  db: DbOrTx,
  id: number,
  changes: PurchaseChanges,
): Promise<void> {
  await db
    .update(purchases)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(purchases.id, id));
}

/** A purchase of this branch with the names behind its ids. */
export async function findPurchase(
  db: DbOrTx,
  branchId: number,
  id: number,
): Promise<PurchaseDetailRow | undefined> {
  const creator = alias(users, 'creator');
  const poster = alias(users, 'poster');
  const canceller = alias(users, 'canceller');
  const [row] = await db
    .select({
      purchase: purchases,
      vendorName: vendors.name,
      createdByName: creator.fullName,
      postedByName: poster.fullName,
      cancelledByName: canceller.fullName,
    })
    .from(purchases)
    .innerJoin(vendors, eq(vendors.id, purchases.vendorId))
    .innerJoin(creator, eq(creator.id, purchases.createdBy))
    .leftJoin(poster, eq(poster.id, purchases.postedBy))
    .leftJoin(canceller, eq(canceller.id, purchases.cancelledBy))
    .where(and(eq(purchases.id, id), eq(purchases.branchId, branchId)))
    .limit(1);
  if (!row) return undefined;
  const { purchase, ...names } = row;
  return { ...purchase, ...names };
}

/** A purchase's lines in the order they were entered, with each item's code and name. */
export async function findLines(db: DbOrTx, purchaseId: number): Promise<PurchaseLineRow[]> {
  const rows = await db
    .select({ line: purchaseLines, itemCode: items.code, itemName: items.name })
    .from(purchaseLines)
    .innerJoin(items, eq(items.id, purchaseLines.itemId))
    .where(eq(purchaseLines.purchaseId, purchaseId))
    .orderBy(asc(purchaseLines.id));
  return rows.map(({ line, ...item }) => ({ ...line, ...item }));
}

/**
 * One page of the branch's purchases, newest invoice date first, with the total. Every filter is
 * optional; the date range compares the invoice date, both ends included.
 */
export async function listPurchases(
  db: DbOrTx,
  branchId: number,
  query: {
    status?: PurchaseRow['status'];
    vendorId?: number;
    from?: string;
    to?: string;
    limit: number;
    offset: number;
  },
): Promise<{ rows: PurchaseSummaryRow[]; total: number }> {
  const conditions: SQL[] = [eq(purchases.branchId, branchId)];
  if (query.status !== undefined) {
    conditions.push(eq(purchases.status, query.status));
  }
  if (query.vendorId !== undefined) {
    conditions.push(eq(purchases.vendorId, query.vendorId));
  }
  if (query.from !== undefined) {
    conditions.push(gte(purchases.invoiceDate, query.from));
  }
  if (query.to !== undefined) {
    conditions.push(lte(purchases.invoiceDate, query.to));
  }
  const where = and(...conditions);

  const rows = await db
    .select(summaryColumns)
    .from(purchases)
    .innerJoin(vendors, eq(vendors.id, purchases.vendorId))
    .where(where)
    .orderBy(desc(purchases.invoiceDate), desc(purchases.id))
    .limit(query.limit)
    .offset(query.offset);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(purchases)
    .where(where);
  return { rows, total: count?.n ?? 0 };
}

/** Whether this vendor exists in this branch and is active. */
export async function activeVendorInBranch(
  db: DbOrTx,
  branchId: number,
  vendorId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(
      and(eq(vendors.id, vendorId), eq(vendors.branchId, branchId), eq(vendors.isActive, true)),
    )
    .limit(1);
  return row !== undefined;
}

/** Which of these item ids are active items of this branch. */
export async function activeItemIdsInBranch(
  db: DbOrTx,
  branchId: number,
  itemIds: number[],
): Promise<Set<number>> {
  if (itemIds.length === 0) return new Set();
  const rows = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(inArray(items.id, itemIds), eq(items.branchId, branchId), eq(items.isActive, true)),
    );
  return new Set(rows.map((row) => row.id));
}

/** An item's current prices, as posting compares them with a line's new prices. */
export type ItemPricesRow = Pick<
  typeof items.$inferSelect,
  'id' | 'name' | 'mrpPaise' | 'sellingPricePaise'
>;

/**
 * Lock these items of this branch (in ascending id order, the system's lock order) until the
 * transaction ends, and return their prices.
 */
export async function lockItemPrices(
  db: DbOrTx,
  branchId: number,
  itemIds: number[],
): Promise<ItemPricesRow[]> {
  if (itemIds.length === 0) return [];
  return db
    .select({
      id: items.id,
      name: items.name,
      mrpPaise: items.mrpPaise,
      sellingPricePaise: items.sellingPricePaise,
    })
    .from(items)
    .where(and(inArray(items.id, itemIds), eq(items.branchId, branchId)))
    .orderBy(asc(items.id))
    .for('update');
}

/** Set an item's prices. */
export async function updateItemPrices(
  db: DbOrTx,
  itemId: number,
  prices: Partial<Pick<ItemPricesRow, 'mrpPaise' | 'sellingPricePaise'>>,
): Promise<void> {
  await db.update(items).set(prices).where(eq(items.id, itemId));
}

/** Mark a purchase posted by this user, now. */
export async function markPosted(db: DbOrTx, id: number, userId: number): Promise<void> {
  const now = new Date();
  await db
    .update(purchases)
    .set({ status: 'posted', postedBy: userId, postedAt: now, updatedAt: now })
    .where(eq(purchases.id, id));
}

/** Mark a purchase cancelled by this user, now, with the reason. */
export async function markCancelled(
  db: DbOrTx,
  id: number,
  userId: number,
  reason: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(purchases)
    .set({
      status: 'cancelled',
      cancelledBy: userId,
      cancelledAt: now,
      cancelReason: reason,
      updatedAt: now,
    })
    .where(eq(purchases.id, id));
}
