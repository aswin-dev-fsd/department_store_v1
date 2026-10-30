// Bill API contract (overview §6.2–6.6, §7.3; D-13 to D-18). The browser sends only item ids,
// quantities, line discounts, payments and an optional customer: every price and total is the
// server's. The schemas are strict, so a price field sent by the client is refused, not ignored.
import { z } from 'zod';
import { customerNameSchema, phoneSchema, type Customer } from './customers.js';
import { MAX_PRICE_PAISE } from './items.js';

/** How a bill can be paid (D-16). Must match the database `payment_mode` enum (tested). */
export const PAYMENT_MODES = ['cash', 'upi', 'card'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** A bill's status. Must match the database `bill_status` enum (tested). */
export const BILL_STATUSES = ['completed', 'cancelled'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

/** A sanity cap on one line's quantity, in packs (D-03). */
export const MAX_BILL_LINE_QUANTITY = 10_000;
/** The most lines one bill may have. */
export const MAX_BILL_LINES = 200;

const amountSchema = z
  .number()
  .int('Enter a whole number of paise')
  .max(MAX_PRICE_PAISE * MAX_BILL_LINE_QUANTITY, 'This amount is too large');

/** One line as the counter sends it: the price is looked up by the server, never sent. */
export const billLineInputSchema = z.strictObject({
  itemId: z.number().int().min(1, 'Choose an item'),
  quantity: z
    .number()
    .int('Enter a whole number of packs')
    .min(1, 'Enter at least 1')
    .max(MAX_BILL_LINE_QUANTITY, 'This quantity is too large'),
  /** An amount off the whole line (D-17); left out means none. */
  discountPaise: amountSchema.min(0, 'A discount cannot be negative').default(0),
});
export type BillLineInput = z.infer<typeof billLineInputSchema>;

/** One payment mode used and how much was paid by it. */
export const billPaymentInputSchema = z.strictObject({
  mode: z.enum(PAYMENT_MODES, { error: 'Choose cash, UPI or card' }),
  amountPaise: amountSchema.min(1, 'A payment must be more than 0'),
});
export type BillPaymentInput = z.infer<typeof billPaymentInputSchema>;

export const createBillSchema = z.strictObject({
  lines: z
    .array(billLineInputSchema)
    .min(1, 'Add at least one item')
    .max(MAX_BILL_LINES, `A bill can have at most ${MAX_BILL_LINES} lines`),
  payments: z
    .array(billPaymentInputSchema)
    .min(1, 'Record how the bill was paid')
    .max(PAYMENT_MODES.length)
    .refine((payments) => new Set(payments.map((p) => p.mode)).size === payments.length, {
      message: 'Record each payment mode once',
    }),
  /** Optional (D-18): a phone finds or creates the customer, client-wide. */
  customer: z
    .strictObject({ phone: phoneSchema, name: customerNameSchema })
    .optional(),
});
export type CreateBillInput = z.infer<typeof createBillSchema>;

/** One line of a saved bill: the item's name, code and prices as they were at the sale. */
export interface BillLine {
  lineNo: number;
  itemId: number;
  itemName: string;
  itemCode: string;
  mrpPaise: number;
  unitPricePaise: number;
  quantity: number;
  discountPaise: number;
  lineTotalPaise: number;
}

export interface BillPayment {
  mode: PaymentMode;
  amountPaise: number;
}

/** A saved bill with its lines, payments and customer. */
export interface Bill {
  id: number;
  /** Like 'TPR/26-27/000123' (D-15). */
  billNo: string;
  fy: string;
  seq: number;
  /** The IST business date, YYYY-MM-DD. */
  billDate: string;
  status: BillStatus;
  cashier: { id: number; fullName: string };
  customer: Customer | null;
  subtotalPaise: number;
  discountPaise: number;
  /** Signed. */
  roundOffPaise: number;
  totalPaise: number;
  lines: BillLine[];
  payments: BillPayment[];
  cancelledBy: { id: number; fullName: string } | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}
