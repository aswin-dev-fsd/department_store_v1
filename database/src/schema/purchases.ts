// Purchase entry (Phase 4): how stock arrives from vendors. Rules: overview §5.2 "Documents", §6.7;
// D-12, D-19, D-26. A purchase is edited freely while it is a draft; posting adds its stock through
// the ledger and locks it; a posted purchase is never edited or deleted, only cancelled with a reason.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { branches, users } from './access.js';
import { items, vendors } from './catalog.js';
import { createdAt, id, ref, timestamptz, updatedAt } from './columns.js';

/** Draft → posted → (cancelled). Only a draft can be edited; only a posted purchase can be cancelled. */
export const purchaseStatus = pgEnum('purchase_status', ['draft', 'posted', 'cancelled']);

/** One vendor invoice received by a branch. */
export const purchases = pgTable(
  'purchases',
  {
    id: id(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    vendorId: ref('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'restrict' }),
    vendorInvoiceNo: text('vendor_invoice_no').notNull(),
    invoiceDate: date('invoice_date', { mode: 'string' }).notNull(),
    status: purchaseStatus('status').notNull().default('draft'),
    // Σ quantity × cost price of the lines, computed by the server (what the store owes is not
    // tracked in v1: D-26)
    totalPaise: bigint('total_paise', { mode: 'number' }).notNull(),
    notes: text('notes'),
    createdBy: ref('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    postedBy: ref('posted_by').references(() => users.id, { onDelete: 'restrict' }),
    postedAt: timestamptz('posted_at'),
    cancelledBy: ref('cancelled_by').references(() => users.id, { onDelete: 'restrict' }),
    cancelledAt: timestamptz('cancelled_at'),
    cancelReason: text('cancel_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // The same vendor invoice can't be entered twice in a branch, in any letter case, unless the
    // earlier one was cancelled (D-19). Drafts count: a second draft of the same invoice is refused
    uniqueIndex('purchases_branch_vendor_invoice_key')
      .on(t.branchId, t.vendorId, sql`lower(${t.vendorInvoiceNo})`)
      .where(sql`${t.status} <> 'cancelled'`),
  ],
);

/**
 * One line of a purchase. Editing a draft replaces all its lines, so a line is never updated in
 * place. New prices, when given, are applied to the item when the purchase is posted (D-12).
 */
export const purchaseLines = pgTable(
  'purchase_lines',
  {
    id: id(),
    purchaseId: ref('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'restrict' }),
    itemId: ref('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    // In packs (D-03)
    quantity: integer('quantity').notNull(),
    costPricePaise: bigint('cost_price_paise', { mode: 'number' }).notNull(),
    newMrpPaise: bigint('new_mrp_paise', { mode: 'number' }),
    newSellingPricePaise: bigint('new_selling_price_paise', { mode: 'number' }),
    // Unused until batch and expiry are decided (PD-02): optional, and billing ignores them
    batchNo: text('batch_no'),
    expiryDate: date('expiry_date', { mode: 'string' }),
    // quantity × cost price, computed by the server
    lineTotalPaise: bigint('line_total_paise', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('purchase_lines_quantity_positive', sql`${t.quantity} > 0`),
    check('purchase_lines_cost_price_non_negative', sql`${t.costPricePaise} >= 0`),
  ],
);
