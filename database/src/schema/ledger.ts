// The stock ledger (Phase 3): the append-only record of every change to stock. Rules: overview
// §5.2 "Ledger and audit", §5.3; D-02. Rows are never edited or deleted; a mistake is corrected
// by a new movement. Only the stock service (Task 3.2) writes here.
import { sql } from 'drizzle-orm';
import { bigint, check, date, index, integer, pgEnum, pgTable, text } from 'drizzle-orm/pg-core';
import { branches, users } from './access.js';
import { items } from './catalog.js';
import { createdAt, id, ref } from './columns.js';

/** Why stock moved. Returns arrive later with FP-02. */
export const movementType = pgEnum('movement_type', [
  'opening',
  'purchase',
  'purchase_cancel',
  'sale',
  'sale_cancel',
  'adjustment',
]);

/** What kind of record `ref_id` points at. */
export const movementRefType = pgEnum('movement_ref_type', [
  'bill',
  'purchase',
  'adjustment',
  'import',
]);

/** The reason an Admin or cashier gives for a manual correction (D-20). */
export const adjustmentReason = pgEnum('adjustment_reason', [
  'damage',
  'expiry',
  'theft',
  'count_correction',
  'other',
]);

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: id(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    itemId: ref('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    type: movementType('type').notNull(),
    // Signed, in packs: + in, − out. Never zero
    quantity: integer('quantity').notNull(),
    // The item's stock right after this movement
    balanceAfter: integer('balance_after').notNull(),
    refType: movementRefType('ref_type').notNull(),
    // The bill, purchase or adjustment behind the movement; empty for an import
    refId: bigint('ref_id', { mode: 'number' }),
    reason: adjustmentReason('reason'),
    note: text('note'),
    // Unused until batch and expiry are decided (PD-02): stay empty
    batchNo: text('batch_no'),
    expiryDate: date('expiry_date', { mode: 'string' }),
    createdBy: ref('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('stock_movements_quantity_non_zero', sql`${t.quantity} <> 0`),
    index('stock_movements_item_created_idx').on(t.itemId, t.createdAt),
  ],
);
