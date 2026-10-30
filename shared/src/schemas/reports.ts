// Report API contract (D-22; overview §6.10, §8). A cashier reads their own day summary and their
// branch's stock; the Admin reads every report for any branch or all of them. Query schemas are
// strict, so a cashier naming another cashier or branch is refused, not quietly ignored.
import { z, type ZodType } from 'zod';
import { wholeNumberText } from './common.js';
import { paginationSchema, type Page } from './pagination.js';
import type { PaymentMode } from './bills.js';

/** The longest range a report may cover, in days, both ends counted. */
export const MAX_REPORT_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A YYYY-MM-DD date in a query string; a day that does not exist is refused. */
const reportDateSchema = z
  .string({ error: 'Enter the date as YYYY-MM-DD' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date as YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, 'Enter a real date');

const positiveId = () =>
  wholeNumberText('Must be a positive whole number').pipe(
    z.number().int().min(1, 'Must be a positive whole number'),
  );

/** Days from `from` to `to`, both counted: the same day is 1. */
export function daysInRange(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;
}

const rangeShape = { from: reportDateSchema, to: reportDateSchema };

/** `to` not before `from`, and at most MAX_REPORT_DAYS days. */
function checkRange(range: { from: string; to: string }, context: z.RefinementCtx): void {
  if (range.to < range.from) {
    context.addIssue({
      code: 'custom',
      path: ['to'],
      message: 'The end date cannot be before the start date',
    });
  } else if (daysInRange(range.from, range.to) > MAX_REPORT_DAYS) {
    context.addIssue({
      code: 'custom',
      path: ['to'],
      message: `Choose a range of at most ${MAX_REPORT_DAYS} days`,
    });
  }
}

// ---- Cashier routes: their own day, their own branch ----

/** GET /reports/day-summary: the cashier's own figures in the branch they work in. */
export const ownDaySummaryQuerySchema = z.strictObject({ date: reportDateSchema });
export type OwnDaySummaryQuery = z.infer<typeof ownDaySummaryQuerySchema>;

/** GET /reports/stock and /reports/low-stock: the branch the cashier works in. */
export const ownStockReportQuerySchema = z.strictObject({
  ...paginationSchema.shape,
  categoryId: positiveId().optional(),
});
export type OwnStockReportQuery = z.infer<typeof ownStockReportQuerySchema>;

// ---- Admin route: GET /admin/reports/:report, any branch or all ----

/** The reports the Admin can ask for: the four of D-22, stock and low stock apart. */
export const REPORTS = [
  'day-summary',
  'item-sales',
  'stock',
  'low-stock',
  'purchase-register',
] as const;
export type ReportName = (typeof REPORTS)[number];

export const reportParamsSchema = z.object({
  report: z.enum(REPORTS, { error: `Choose one of: ${REPORTS.join(', ')}` }),
});
export type ReportParams = z.infer<typeof reportParamsSchema>;

/** Leaving out `branchId` covers every branch. */
const branchIdShape = { branchId: positiveId().optional() };

const adminStockQuerySchema = z.strictObject({
  ...paginationSchema.shape,
  ...branchIdShape,
  categoryId: positiveId().optional(),
});

/** Each report's query for the Admin. */
export const adminReportQuerySchemas = {
  'day-summary': z.strictObject({
    date: reportDateSchema,
    ...branchIdShape,
    cashierId: positiveId().optional(),
  }),
  'item-sales': z
    .strictObject({ ...paginationSchema.shape, ...rangeShape, ...branchIdShape })
    .superRefine(checkRange),
  stock: adminStockQuerySchema,
  'low-stock': adminStockQuerySchema,
  'purchase-register': z.strictObject({ ...rangeShape, ...branchIdShape }).superRefine(checkRange),
} as const satisfies Record<ReportName, ZodType>;

export type AdminDaySummaryQuery = z.infer<(typeof adminReportQuerySchemas)['day-summary']>;
export type AdminItemSalesQuery = z.infer<(typeof adminReportQuerySchemas)['item-sales']>;
export type AdminStockReportQuery = z.infer<typeof adminStockQuerySchema>;
export type AdminPurchaseRegisterQuery = z.infer<
  (typeof adminReportQuerySchemas)['purchase-register']
>;

// ---- What the reports answer ----

/** A day's figures for a cashier, a branch or everything (Task 6.2). */
export interface DayTotals {
  /** Completed bills only. */
  billCount: number;
  subtotalPaise: number;
  discountPaise: number;
  /** Signed. */
  roundOffPaise: number;
  /** The net total: subtotal − discount + round-off. */
  totalPaise: number;
  /** What the completed bills were paid by. */
  payments: Record<PaymentMode, number>;
  /** Cancelled bills of the day, kept out of every figure above. */
  cancelledCount: number;
  cancelledPaise: number;
}

export interface CashierDay {
  cashier: { id: number; fullName: string };
  totals: DayTotals;
}

export interface BranchDay {
  branch: { id: number; code: string; name: string };
  totals: DayTotals;
  /** By name. */
  cashiers: CashierDay[];
}

export interface DaySummary {
  /** The IST business date. */
  date: string;
  /** Every branch and cashier below, added up. */
  totals: DayTotals;
  /** By branch code; only branches with bills that day. */
  branches: BranchDay[];
}

/** One item in the item-wise sales (Task 6.3). */
export interface ItemSalesRow {
  item: { id: number; code: string; name: string };
  branch: { id: number; code: string };
  /** Packs sold. */
  quantity: number;
  /** The sum of the line totals, after line discounts. */
  valuePaise: number;
}

export interface ItemSalesReport extends Page<ItemSalesRow> {
  from: string;
  to: string;
  /** Every item's value in the range, all pages. */
  itemsValuePaise: number;
  /** The completed bills' round-off in the range: in no item. */
  roundOffPaise: number;
  /** The completed bills' total: itemsValuePaise + roundOffPaise. */
  billsTotalPaise: number;
  /** Why the two totals differ. */
  note: string;
}

/** One item in the stock and low-stock reports (Task 6.4). */
export interface StockReportRow {
  item: { id: number; code: string; name: string };
  branch: { id: number; code: string };
  category: { id: number; name: string } | null;
  /** Packs on hand. */
  quantity: number;
  sellingPricePaise: number;
  /** In packs; null when no warning is wanted. */
  reorderLevel: number | null;
}

/** One purchase in the purchase register (Task 6.5). */
export interface RegisterPurchase {
  id: number;
  vendorInvoiceNo: string;
  /** YYYY-MM-DD. */
  invoiceDate: string;
  totalPaise: number;
}

export interface RegisterVendor {
  vendor: { id: number; name: string };
  branch: { id: number; code: string };
  /** By invoice date, then invoice number. */
  purchases: RegisterPurchase[];
  subtotalPaise: number;
}

export interface CancelledPurchase extends RegisterPurchase {
  vendor: { id: number; name: string };
  branch: { id: number; code: string };
  cancelReason: string | null;
}

export interface PurchaseRegister {
  from: string;
  to: string;
  /** By vendor name; posted purchases only. */
  vendors: RegisterVendor[];
  /** All posted purchases in the range. */
  totalPaise: number;
  /** Cancelled purchases in the range, in no total. */
  cancelled: CancelledPurchase[];
}
