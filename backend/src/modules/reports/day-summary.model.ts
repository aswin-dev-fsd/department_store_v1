import { schema, type Db } from '@ds/database';
import { and, asc, eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';

// Database queries for the day sales summary only; the rules live in day-summary.service.

const { bills, billPayments, branches, users } = schema;

export interface DayFilter {
  /** The IST business date, YYYY-MM-DD. */
  date: string;
  branchId?: number | undefined;
  cashierId?: number | undefined;
}

function billConditions({ date, branchId, cashierId }: DayFilter): SQL[] {
  const conditions: SQL[] = [eq(bills.billDate, date)];
  if (branchId !== undefined) conditions.push(eq(bills.branchId, branchId));
  if (cashierId !== undefined) conditions.push(eq(bills.cashierId, cashierId));
  return conditions;
}

const completed = sql`${bills.status} = 'completed'`;
const cancelled = sql`${bills.status} = 'cancelled'`;

/** A sum of paise over the matching bills, 0 when none match. */
const sumWhere = (column: AnyColumn, where: SQL) =>
  sql<number>`coalesce(sum(${column}) filter (where ${where}), 0)`.mapWith(Number);

/** The day's bills per branch and cashier: completed amounts, and cancelled count and value apart. */
export async function sumBillsByCashier(db: Db, filter: DayFilter) {
  return db
    .select({
      branchId: bills.branchId,
      branchCode: branches.code,
      branchName: branches.name,
      cashierId: bills.cashierId,
      cashierName: users.fullName,
      billCount: sql<number>`count(*) filter (where ${completed})`.mapWith(Number),
      subtotalPaise: sumWhere(bills.subtotalPaise, completed),
      discountPaise: sumWhere(bills.discountPaise, completed),
      roundOffPaise: sumWhere(bills.roundOffPaise, completed),
      totalPaise: sumWhere(bills.totalPaise, completed),
      cancelledCount: sql<number>`count(*) filter (where ${cancelled})`.mapWith(Number),
      cancelledPaise: sumWhere(bills.totalPaise, cancelled),
    })
    .from(bills)
    .innerJoin(branches, eq(branches.id, bills.branchId))
    .innerJoin(users, eq(users.id, bills.cashierId))
    .where(and(...billConditions(filter)))
    .groupBy(bills.branchId, branches.code, branches.name, bills.cashierId, users.fullName)
    .orderBy(asc(branches.code), asc(users.fullName), asc(bills.cashierId));
}

/** What the day's completed bills were paid by, per branch, cashier and mode. */
export async function sumPaymentsByCashier(db: Db, filter: DayFilter) {
  return db
    .select({
      branchId: bills.branchId,
      cashierId: bills.cashierId,
      mode: billPayments.mode,
      amountPaise: sql<number>`sum(${billPayments.amountPaise})`.mapWith(Number),
    })
    .from(billPayments)
    .innerJoin(bills, eq(bills.id, billPayments.billId))
    .where(and(...billConditions(filter), completed))
    .groupBy(bills.branchId, bills.cashierId, billPayments.mode);
}
