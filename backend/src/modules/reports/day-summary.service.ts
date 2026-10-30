// The day sales summary (D-21, D-22; overview §6.10, §7.7): the day-end report a cashier
// reconciles the cash drawer against. Bills count on their IST business date (`bill_date`, Task
// 5.2). Cancelled bills never count in the totals; their count and value are shown apart.
import type { Db } from '@ds/database';
import {
  PAYMENT_MODES,
  type BranchDay,
  type DaySummary,
  type DayTotals,
  type PaymentMode,
} from '@ds/shared';
import * as model from './day-summary.model.js';

export interface DaySummaryQuery {
  /** The IST business date, YYYY-MM-DD. */
  date: string;
  /** Only this branch. */
  branchId?: number | undefined;
  /** Only this cashier's bills (a cashier sees their own). */
  cashierId?: number | undefined;
}

function emptyTotals(): DayTotals {
  return {
    billCount: 0,
    subtotalPaise: 0,
    discountPaise: 0,
    roundOffPaise: 0,
    totalPaise: 0,
    payments: Object.fromEntries(PAYMENT_MODES.map((mode) => [mode, 0])) as Record<
      PaymentMode,
      number
    >,
    cancelledCount: 0,
    cancelledPaise: 0,
  };
}

/** Add `from` into `into`. */
function addTotals(into: DayTotals, from: DayTotals): void {
  into.billCount += from.billCount;
  into.subtotalPaise += from.subtotalPaise;
  into.discountPaise += from.discountPaise;
  into.roundOffPaise += from.roundOffPaise;
  into.totalPaise += from.totalPaise;
  for (const mode of PAYMENT_MODES) into.payments[mode] += from.payments[mode];
  into.cancelledCount += from.cancelledCount;
  into.cancelledPaise += from.cancelledPaise;
}

/**
 * The day's sales per cashier, per branch and overall, for one IST business date, optionally for
 * one branch or one cashier. Who may see what (a cashier their own totals, the Admin everything)
 * is decided by the route (Task 6.6), which passes the matching filter.
 */
export async function daySummary(db: Db, query: DaySummaryQuery): Promise<DaySummary> {
  const [rows, payments] = await Promise.all([
    model.sumBillsByCashier(db, query),
    model.sumPaymentsByCashier(db, query),
  ]);

  const paid = new Map<string, Record<PaymentMode, number>>();
  for (const row of payments) {
    const key = `${row.branchId}:${row.cashierId}`;
    const byMode = paid.get(key) ?? emptyTotals().payments;
    byMode[row.mode] += row.amountPaise;
    paid.set(key, byMode);
  }

  const totals = emptyTotals();
  const branches: BranchDay[] = [];
  for (const row of rows) {
    let branch = branches.at(-1);
    if (branch?.branch.id !== row.branchId) {
      branch = {
        branch: { id: row.branchId, code: row.branchCode, name: row.branchName },
        totals: emptyTotals(),
        cashiers: [],
      };
      branches.push(branch);
    }
    const cashierTotals: DayTotals = {
      billCount: row.billCount,
      subtotalPaise: row.subtotalPaise,
      discountPaise: row.discountPaise,
      roundOffPaise: row.roundOffPaise,
      totalPaise: row.totalPaise,
      payments: paid.get(`${row.branchId}:${row.cashierId}`) ?? emptyTotals().payments,
      cancelledCount: row.cancelledCount,
      cancelledPaise: row.cancelledPaise,
    };
    branch.cashiers.push({
      cashier: { id: row.cashierId, fullName: row.cashierName },
      totals: cashierTotals,
    });
    addTotals(branch.totals, cashierTotals);
    addTotals(totals, cashierTotals);
  }

  return { date: query.date, totals, branches };
}
