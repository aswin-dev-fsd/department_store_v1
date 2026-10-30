// Database queries for bills — no business rules here (DreamLand §4). Every function that reads a
// bill takes the branch: bills are branch-owned, so another branch's is simply not found.
import { schema, type DbOrTx } from '@ds/database';
import { and, asc, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { likePattern } from '../../lib/like.js';

const { billLines, billPayments, bills, branches, clientSettings, customers, items, users } =
  schema;

export type BillRow = typeof bills.$inferSelect;
export type NewBillRow = typeof bills.$inferInsert;
export type NewBillLineRow = typeof billLines.$inferInsert;
export type NewBillPaymentRow = typeof billPayments.$inferInsert;
export type BillLineRow = typeof billLines.$inferSelect;
export type BillPaymentRow = typeof billPayments.$inferSelect;

/** A bill with the names behind its ids. */
export type BillDetailRow = BillRow & {
  cashierName: string;
  cancelledByName: string | null;
  customerPhone: string | null;
  customerName: string | null;
};

/** What a bill line needs from its item: the current price and the snapshot fields. */
export type SellableItem = Pick<
  typeof items.$inferSelect,
  'id' | 'code' | 'name' | 'mrpPaise' | 'sellingPricePaise'
>;

/** The branch's code, used in its bill numbers. */
export async function findBranchCode(db: DbOrTx, branchId: number): Promise<string | undefined> {
  const [row] = await db
    .select({ code: branches.code })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
  return row?.code;
}

/** Which of these items are active items of this branch, with their current prices. */
export async function findSellableItems(
  db: DbOrTx,
  branchId: number,
  itemIds: number[],
): Promise<SellableItem[]> {
  if (itemIds.length === 0) return [];
  return db
    .select({
      id: items.id,
      code: items.code,
      name: items.name,
      mrpPaise: items.mrpPaise,
      sellingPricePaise: items.sellingPricePaise,
    })
    .from(items)
    .where(and(inArray(items.id, itemIds), eq(items.branchId, branchId), eq(items.isActive, true)));
}

/** Insert a bill and return the new row. */
export async function insertBill(db: DbOrTx, values: NewBillRow): Promise<BillRow> {
  const [row] = await db.insert(bills).values(values).returning();
  return row!;
}

/** Insert a bill's lines, in the order given. */
export async function insertLines(db: DbOrTx, rows: NewBillLineRow[]): Promise<void> {
  await db.insert(billLines).values(rows);
}

/** Insert a bill's payments. */
export async function insertPayments(db: DbOrTx, rows: NewBillPaymentRow[]): Promise<void> {
  await db.insert(billPayments).values(rows);
}

/** A bill of this branch with its cashier's, canceller's and customer's details. */
export async function findBill(
  db: DbOrTx,
  branchId: number,
  id: number,
): Promise<BillDetailRow | undefined> {
  const cashier = alias(users, 'cashier');
  const canceller = alias(users, 'canceller');
  const [row] = await db
    .select({
      bill: bills,
      cashierName: cashier.fullName,
      cancelledByName: canceller.fullName,
      customerPhone: customers.phone,
      customerName: customers.name,
    })
    .from(bills)
    .innerJoin(cashier, eq(cashier.id, bills.cashierId))
    .leftJoin(canceller, eq(canceller.id, bills.cancelledBy))
    .leftJoin(customers, eq(customers.id, bills.customerId))
    .where(and(eq(bills.id, id), eq(bills.branchId, branchId)))
    .limit(1);
  if (!row) return undefined;
  const { bill, ...names } = row;
  return { ...bill, ...names };
}

/** A bill's lines in line order. */
export async function findLines(db: DbOrTx, billId: number): Promise<BillLineRow[]> {
  return db
    .select()
    .from(billLines)
    .where(eq(billLines.billId, billId))
    .orderBy(asc(billLines.lineNo));
}

/** A bill's payments in the order they were recorded. */
export async function findPayments(db: DbOrTx, billId: number): Promise<BillPaymentRow[]> {
  return db
    .select()
    .from(billPayments)
    .where(eq(billPayments.billId, billId))
    .orderBy(asc(billPayments.id));
}

/** Load a bill of this branch and lock its row until the transaction ends. */
export async function findBillForUpdate(
  db: DbOrTx,
  branchId: number,
  id: number,
): Promise<BillRow | undefined> {
  const [row] = await db
    .select()
    .from(bills)
    .where(and(eq(bills.id, id), eq(bills.branchId, branchId)))
    .limit(1)
    .for('update');
  return row;
}

/** Mark a bill cancelled by this user, now, with the reason. */
export async function markCancelled(
  db: DbOrTx,
  id: number,
  userId: number,
  reason: string,
): Promise<void> {
  await db
    .update(bills)
    .set({ status: 'cancelled', cancelledBy: userId, cancelledAt: new Date(), cancelReason: reason })
    .where(eq(bills.id, id));
}

/** A bill in a list, with its cashier's name and its customer. */
export interface BillSummaryRow {
  id: number;
  billNo: string;
  billDate: string;
  status: BillRow['status'];
  cashierId: number;
  cashierName: string;
  customerPhone: string | null;
  customerName: string | null;
  totalPaise: number;
  createdAt: Date;
}

/**
 * One page of the branch's bills, newest first, with the total. Every filter is optional; the
 * date range compares the business date, both ends included; `billNo` matches any part of it,
 * ignoring case; `phone` is the customer's normalised phone.
 */
export async function listBills(
  db: DbOrTx,
  branchId: number,
  query: {
    from?: string;
    to?: string;
    billNo?: string;
    phone?: string;
    cashierId?: number;
    status?: BillRow['status'];
    limit: number;
    offset: number;
  },
): Promise<{ rows: BillSummaryRow[]; total: number }> {
  const conditions: SQL[] = [eq(bills.branchId, branchId)];
  if (query.from !== undefined) conditions.push(gte(bills.billDate, query.from));
  if (query.to !== undefined) conditions.push(lte(bills.billDate, query.to));
  if (query.billNo !== undefined) conditions.push(ilike(bills.billNo, likePattern(query.billNo)));
  if (query.phone !== undefined) conditions.push(eq(customers.phone, query.phone));
  if (query.cashierId !== undefined) conditions.push(eq(bills.cashierId, query.cashierId));
  if (query.status !== undefined) conditions.push(eq(bills.status, query.status));
  const where = and(...conditions);

  const rows = await db
    .select({
      id: bills.id,
      billNo: bills.billNo,
      billDate: bills.billDate,
      status: bills.status,
      cashierId: bills.cashierId,
      cashierName: users.fullName,
      customerPhone: customers.phone,
      customerName: customers.name,
      totalPaise: bills.totalPaise,
      createdAt: bills.createdAt,
    })
    .from(bills)
    .innerJoin(users, eq(users.id, bills.cashierId))
    .leftJoin(customers, eq(customers.id, bills.customerId))
    .where(where)
    .orderBy(desc(bills.createdAt), desc(bills.id))
    .limit(query.limit)
    .offset(query.offset);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bills)
    .leftJoin(customers, eq(customers.id, bills.customerId))
    .where(where);
  return { rows, total: count?.n ?? 0 };
}

/** The business details and the branch details a receipt prints. */
export async function findReceiptHeader(db: DbOrTx, branchId: number) {
  const [settings] = await db.select().from(clientSettings).limit(1);
  const [branch] = await db.select().from(branches).where(eq(branches.id, branchId)).limit(1);
  return { settings, branch };
}
