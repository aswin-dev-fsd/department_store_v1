// Purchase API contract (cashiers, per branch; overview §6.7, §7.5; D-12, D-19, D-26). Used by
// the backend (validation) and the frontend (the purchase editor). Money is integer paise; the
// server computes every line total and the purchase total, so the client never sends them.
import { z } from 'zod';
import { optionalText, wholeNumberText } from './common.js';
import { MAX_PRICE_PAISE } from './items.js';
import { paginationSchema } from './pagination.js';

/** Draft → posted → (cancelled). Must match the database `purchase_status` enum (tested). */
export const PURCHASE_STATUSES = ['draft', 'posted', 'cancelled'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

/** A sanity cap on one line's quantity, in packs (D-03); the same as an import's opening stock. */
export const MAX_LINE_QUANTITY = 1_000_000;
/** The most lines one purchase may have. */
export const MAX_PURCHASE_LINES = 500;
const INVOICE_NO_MAX = 50;

/** Shown when the lines add up to more than the server can total exactly. */
export const PURCHASE_TOTAL_TOO_LARGE_MESSAGE = 'This purchase total is too large';

/** A calendar date as YYYY-MM-DD; a day that does not exist (2026-02-30) is refused. */
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date as YYYY-MM-DD')
  .refine(
    (value) => {
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
    },
    { message: 'Enter a real date' },
  );

const paiseSchema = z
  .number()
  .int('Enter a whole number of paise')
  .min(0, 'A price cannot be negative')
  .max(MAX_PRICE_PAISE, 'This price is too large');

const positiveId = (message: string) => z.number().int().min(1, message);

/**
 * The vendor's own invoice number: trimmed, 1–50 characters. Unique per vendor and branch, in any
 * letter case, unless the earlier purchase was cancelled (the server's check).
 */
export const vendorInvoiceNoSchema = z
  .string()
  .trim()
  .min(1, 'Enter the vendor invoice number')
  .max(INVOICE_NO_MAX, `Use at most ${INVOICE_NO_MAX} characters`);

/**
 * One line as the client sends it. New prices are optional; they are applied to the item when the
 * purchase is posted (Task 4.3), where the selling price ≤ MRP rule is checked. Batch number and
 * expiry date are not accepted until PD-02 is decided: unknown fields are dropped.
 */
export const purchaseLineInputSchema = z.object({
  itemId: positiveId('Choose an item'),
  quantity: z
    .number()
    .int('Enter a whole number of packs')
    .min(1, 'Enter at least 1')
    .max(MAX_LINE_QUANTITY, 'This quantity is too large'),
  costPricePaise: paiseSchema,
  newMrpPaise: paiseSchema.nullable().optional(),
  newSellingPricePaise: paiseSchema.nullable().optional(),
});
export type PurchaseLineInput = z.infer<typeof purchaseLineInputSchema>;

/** Σ quantity × cost price: the line totals and the purchase total, as the server stores them. */
export function purchaseTotalPaise(
  lines: readonly { quantity: number; costPricePaise: number }[],
): number {
  return lines.reduce((total, line) => total + line.quantity * line.costPricePaise, 0);
}

/**
 * A whole draft: the header and every line (zero or more). Creating a draft and editing one send
 * the same body; an edit replaces the header and all the lines. Totals, status and the post and
 * cancel fields are the server's: they are not accepted here.
 */
export const purchaseDraftSchema = z.object({
  vendorId: positiveId('Choose a vendor'),
  vendorInvoiceNo: vendorInvoiceNoSchema,
  invoiceDate: calendarDateSchema,
  notes: optionalText(500),
  lines: z
    .array(purchaseLineInputSchema)
    .max(MAX_PURCHASE_LINES, `A purchase can have at most ${MAX_PURCHASE_LINES} lines`)
    // Each line total fits exactly; this keeps their sum exact too (below 2^53)
    .refine((lines) => purchaseTotalPaise(lines) <= Number.MAX_SAFE_INTEGER, {
      message: PURCHASE_TOTAL_TOO_LARGE_MESSAGE,
    })
    .default([]),
});
export type PurchaseDraftInput = z.infer<typeof purchaseDraftSchema>;

/** Filter by status, vendor and invoice date range (both ends included); newest invoice first. */
export const listPurchasesQuerySchema = paginationSchema
  .extend({
    status: z.enum(PURCHASE_STATUSES).optional(),
    vendorId: wholeNumberText('Must be a positive whole number')
      .pipe(z.number().int().min(1, 'Must be a positive whole number'))
      .optional(),
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    path: ['to'],
    message: 'The end date cannot be before the start date',
  });
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuerySchema>;

/** Why a posted purchase is cancelled: trimmed, 3–200 characters, required. */
export const cancelPurchaseSchema = z.object({
  reason: z
    .string({ error: 'Enter the reason for cancelling' })
    .trim()
    .min(3, 'Enter the reason for cancelling (at least 3 characters)')
    .max(200, 'Use at most 200 characters'),
});
export type CancelPurchaseInput = z.infer<typeof cancelPurchaseSchema>;

/** Someone who created, posted or cancelled a purchase. */
export interface PurchaseUser {
  id: number;
  fullName: string;
}

/** A purchase in a list: the header only. */
export interface PurchaseSummary {
  id: number;
  vendor: { id: number; name: string };
  vendorInvoiceNo: string;
  /** YYYY-MM-DD, the date on the vendor's invoice. */
  invoiceDate: string;
  status: PurchaseStatus;
  totalPaise: number;
  createdAt: string;
  updatedAt: string;
}

/** One line of a purchase, with the item's current code and name. */
export interface PurchaseLine {
  id: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  quantity: number;
  costPricePaise: number;
  newMrpPaise: number | null;
  newSellingPricePaise: number | null;
  /** quantity × cost price. */
  lineTotalPaise: number;
}

/** One purchase with its lines, in the order they were entered. */
export interface Purchase extends PurchaseSummary {
  notes: string | null;
  createdBy: PurchaseUser;
  postedBy: PurchaseUser | null;
  postedAt: string | null;
  cancelledBy: PurchaseUser | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lines: PurchaseLine[];
}
