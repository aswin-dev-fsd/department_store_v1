// The billing counter (Phase 5). Rules: overview §5.2 "Documents", §6.2–6.6; D-13 to D-18. A saved
// bill is never edited or deleted, only cancelled with a reason (D-14); its number stays in the
// sequence. Money is integer paise; the server computes every amount.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { branches, users } from './access.js';
import { items } from './catalog.js';
import { createdAt, id, ref, timestamptz } from './columns.js';
import { customers } from './customers.js';

/** A bill is saved complete, and may later be cancelled (D-14). */
export const billStatus = pgEnum('bill_status', ['completed', 'cancelled']);

/** How the customer paid; one bill may be split across modes (D-16). */
export const paymentMode = pgEnum('payment_mode', ['cash', 'upi', 'card']);

/**
 * One sale. `bill_no` is e.g. `TPR/26-27/000123`: the branch code, the financial year and the
 * branch's running number for that year (D-15), allocated from `bill_sequences` inside the bill's
 * own transaction, so the numbers have no gaps.
 */
export const bills = pgTable(
  'bills',
  {
    id: id(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    // Financial year in IST, like '26-27'
    fy: text('fy').notNull(),
    seq: integer('seq').notNull(),
    billNo: text('bill_no').notNull(),
    // The IST business date of the sale
    billDate: date('bill_date', { mode: 'string' }).notNull(),
    cashierId: ref('cashier_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    customerId: ref('customer_id').references(() => customers.id, { onDelete: 'restrict' }),
    // Σ quantity × unit price, before discounts
    subtotalPaise: bigint('subtotal_paise', { mode: 'number' }).notNull(),
    // Σ line discounts (no whole-bill discount in v1: D-17)
    discountPaise: bigint('discount_paise', { mode: 'number' }).notNull(),
    // Signed: what rounding the net amount to the nearest rupee added or took away
    roundOffPaise: bigint('round_off_paise', { mode: 'number' }).notNull(),
    totalPaise: bigint('total_paise', { mode: 'number' }).notNull(),
    // Unused until GST is decided (PD-01): stay empty
    taxablePaise: bigint('taxable_paise', { mode: 'number' }),
    taxPaise: bigint('tax_paise', { mode: 'number' }),
    status: billStatus('status').notNull().default('completed'),
    cancelledBy: ref('cancelled_by').references(() => users.id, { onDelete: 'restrict' }),
    cancelledAt: timestamptz('cancelled_at'),
    cancelReason: text('cancel_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('bills_bill_no_key').on(t.billNo),
    unique('bills_branch_fy_seq_key').on(t.branchId, t.fy, t.seq),
    index('bills_branch_date_idx').on(t.branchId, t.billDate),
    index('bills_cashier_date_idx').on(t.cashierId, t.billDate),
    index('bills_customer_id_idx').on(t.customerId),
  ],
);

/**
 * One line of a bill. The item's name, code and prices are a snapshot taken at the sale, so an old
 * bill never changes when the item is edited later.
 */
export const billLines = pgTable(
  'bill_lines',
  {
    id: id(),
    billId: ref('bill_id')
      .notNull()
      .references(() => bills.id, { onDelete: 'restrict' }),
    // 1, 2, 3, … in the order the items were entered
    lineNo: integer('line_no').notNull(),
    itemId: ref('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    itemName: text('item_name').notNull(),
    itemCode: text('item_code').notNull(),
    mrpPaise: bigint('mrp_paise', { mode: 'number' }).notNull(),
    unitPricePaise: bigint('unit_price_paise', { mode: 'number' }).notNull(),
    // In packs (D-03)
    quantity: integer('quantity').notNull(),
    // An amount for the whole line, never more than the line's amount (D-17)
    discountPaise: bigint('discount_paise', { mode: 'number' }).notNull(),
    // quantity × unit price − discount
    lineTotalPaise: bigint('line_total_paise', { mode: 'number' }).notNull(),
    // Unused until GST is decided (PD-01): stay empty
    hsnCode: text('hsn_code'),
    gstRate: numeric('gst_rate', { precision: 5, scale: 2 }),
    taxablePaise: bigint('taxable_paise', { mode: 'number' }),
    cgstPaise: bigint('cgst_paise', { mode: 'number' }),
    sgstPaise: bigint('sgst_paise', { mode: 'number' }),
    igstPaise: bigint('igst_paise', { mode: 'number' }),
  },
  (t) => [
    check('bill_lines_quantity_positive', sql`${t.quantity} > 0`),
    check('bill_lines_discount_non_negative', sql`${t.discountPaise} >= 0`),
  ],
);

/** How a bill was paid: one row per mode used. The amounts add up to the bill total (D-16). */
export const billPayments = pgTable(
  'bill_payments',
  {
    id: id(),
    billId: ref('bill_id')
      .notNull()
      .references(() => bills.id, { onDelete: 'restrict' }),
    mode: paymentMode('mode').notNull(),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
  },
  (t) => [check('bill_payments_amount_positive', sql`${t.amountPaise} > 0`)],
);

/**
 * The last bill number used per branch and financial year (D-15). The bill transaction takes the
 * next one with `INSERT … ON CONFLICT DO UPDATE … RETURNING` (Task 5.3), which also locks the row
 * until the bill commits, so two counters never get the same number and a failed bill leaves no
 * gap.
 */
export const billSequences = pgTable(
  'bill_sequences',
  {
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    fy: text('fy').notNull(),
    lastSeq: integer('last_seq').notNull(),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.fy] })],
);
