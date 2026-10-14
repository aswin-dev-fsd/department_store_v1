// What a branch sells and buys from (Phase 3). Rules: overview §5.2 "Catalog"; D-03, D-08, D-11,
// D-12, D-23. Items, categories and vendors each belong to one branch; nothing here is ever
// deleted, only deactivated.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { branches } from './access.js';
import { createdAt, id, ref, updatedAt } from './columns.js';

/** An optional grouping of items, listed per branch (D-23). */
export const categories = pgTable(
  'categories',
  {
    id: id(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('categories_branch_name_lower_key').on(t.branchId, sql`lower(${t.name})`)],
);

/**
 * Something the branch sells. The name carries the size, e.g. "Rice 10 kg" (D-03). Prices are
 * integer paise (D-12): one current MRP and selling price; a purchase may update them.
 */
export const items = pgTable(
  'items',
  {
    id: id(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    // Scanned at the counter; optional, but unique within the branch when present (D-11)
    barcode: text('barcode'),
    name: text('name').notNull(),
    categoryId: ref('category_id').references(() => categories.id, { onDelete: 'restrict' }),
    mrpPaise: bigint('mrp_paise', { mode: 'number' }).notNull(),
    sellingPricePaise: bigint('selling_price_paise', { mode: 'number' }).notNull(),
    // Low-stock warnings use this in packs; empty means "no warning"
    reorderLevel: integer('reorder_level'),
    // Unused until GST is decided (PD-01): stay empty
    hsnCode: text('hsn_code'),
    gstRate: numeric('gst_rate', { precision: 5, scale: 2 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('items_branch_code_key').on(t.branchId, t.code),
    uniqueIndex('items_branch_barcode_key')
      .on(t.branchId, t.barcode)
      .where(sql`${t.barcode} is not null`),
    index('items_branch_name_lower_idx').on(t.branchId, sql`lower(${t.name})`),
  ],
);

/**
 * How many of an item are on the shelf now, in packs. Changed only by the stock ledger service
 * (Task 3.2), in the same transaction as the movement row that explains the change, so it always
 * equals the sum of the item's ledger rows. The CHECK stops stock going below zero (D-13).
 */
export const itemStock = pgTable(
  'item_stock',
  {
    itemId: ref('item_id')
      .primaryKey()
      .references(() => items.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
  },
  (t) => [check('item_stock_quantity_non_negative', sql`${t.quantity} >= 0`)],
);

/** A supplier the branch buys from (D-08). */
export const vendors = pgTable('vendors', {
  id: id(),
  branchId: ref('branch_id')
    .notNull()
    .references(() => branches.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  phone: text('phone'),
  gstin: text('gstin'),
  address: text('address'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
