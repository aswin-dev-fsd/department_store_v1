import { schema, type Db } from '@ds/database';
import { and, asc, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';

// Database queries for the item-wise sales report only; the rules live in item-sales.service.

const { bills, billLines, branches, items } = schema;

export interface RangeFilter {
  /** IST business dates, YYYY-MM-DD, both included. */
  from: string;
  to: string;
  branchId?: number | undefined;
}

/** Completed bills in the range (and branch). */
function completedIn({ from, to, branchId }: RangeFilter): SQL {
  const conditions: SQL[] = [
    eq(bills.status, 'completed'),
    gte(bills.billDate, from),
    lte(bills.billDate, to),
  ];
  if (branchId !== undefined) conditions.push(eq(bills.branchId, branchId));
  return and(...conditions)!;
}

const quantitySum = sql<number>`sum(${billLines.quantity})`.mapWith(Number);
const valueSum = sql<number>`sum(${billLines.lineTotalPaise})`.mapWith(Number);

/** One page of items sold in the range: packs and value, the highest value first. */
export async function sumByItem(db: Db, filter: RangeFilter, limit: number, offset: number) {
  return db
    .select({
      itemId: items.id,
      code: items.code,
      name: items.name,
      branchId: branches.id,
      branchCode: branches.code,
      quantity: quantitySum,
      valuePaise: valueSum,
    })
    .from(billLines)
    .innerJoin(bills, eq(bills.id, billLines.billId))
    .innerJoin(items, eq(items.id, billLines.itemId))
    .innerJoin(branches, eq(branches.id, bills.branchId))
    .where(completedIn(filter))
    .groupBy(items.id, items.code, items.name, branches.id, branches.code)
    .orderBy(desc(valueSum), asc(items.name), asc(items.id))
    .limit(limit)
    .offset(offset);
}

/** How many items were sold in the range, and their value and the bills' round-off in all. */
export async function rangeTotals(db: Db, filter: RangeFilter) {
  const [lines] = await db
    .select({
      itemCount: sql<number>`count(distinct ${billLines.itemId})`.mapWith(Number),
      valuePaise: sql<number>`coalesce(sum(${billLines.lineTotalPaise}), 0)`.mapWith(Number),
    })
    .from(billLines)
    .innerJoin(bills, eq(bills.id, billLines.billId))
    .where(completedIn(filter));
  const [money] = await db
    .select({
      roundOffPaise: sql<number>`coalesce(sum(${bills.roundOffPaise}), 0)`.mapWith(Number),
      totalPaise: sql<number>`coalesce(sum(${bills.totalPaise}), 0)`.mapWith(Number),
    })
    .from(bills)
    .where(completedIn(filter));
  return { ...lines!, ...money! };
}
