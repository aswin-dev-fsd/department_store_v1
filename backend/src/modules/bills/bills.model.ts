// Database queries for bills — no business rules here (DreamLand §4). Every function that reads a
// bill takes the branch: bills are branch-owned, so another branch's is simply not found.
import { schema, type DbOrTx } from '@ds/database';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

const { billLines, billPayments, bills, branches, customers, items, users } = schema;

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
