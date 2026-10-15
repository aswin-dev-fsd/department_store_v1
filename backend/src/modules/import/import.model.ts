// Database queries for the CSV import — no business rules here (DreamLand §4). The service batches
// the rows, so every function is one statement over a bounded list.
import { schema, type DbOrTx } from '@ds/database';
import { and, eq, inArray } from 'drizzle-orm';

const { categories, items, itemStock } = schema;

export type NewItemRow = typeof items.$inferInsert;

export interface CategoryRef {
  id: number;
  name: string;
}

export interface ItemRef {
  id: number;
  code: string;
}

/** The branch's categories. */
export async function listCategories(db: DbOrTx, branchId: number): Promise<CategoryRef[]> {
  return db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.branchId, branchId));
}

/** Insert categories for the branch and return them. A name it already has raises a unique violation. */
export async function insertCategories(
  db: DbOrTx,
  branchId: number,
  names: string[],
): Promise<CategoryRef[]> {
  if (names.length === 0) return [];
  return db
    .insert(categories)
    .values(names.map((name) => ({ branchId, name })))
    .returning({ id: categories.id, name: categories.name });
}

/** Insert items and return their ids with their codes. A code or barcode in use raises a unique violation. */
export async function insertItems(db: DbOrTx, rows: NewItemRow[]): Promise<ItemRef[]> {
  if (rows.length === 0) return [];
  return db.insert(items).values(rows).returning({ id: items.id, code: items.code });
}

/** Give new items their item_stock row, at 0. Their opening stock then goes through the ledger. */
export async function insertStockRows(db: DbOrTx, itemIds: number[]): Promise<void> {
  if (itemIds.length === 0) return;
  await db.insert(itemStock).values(itemIds.map((itemId) => ({ itemId, quantity: 0 })));
}

/** Those of these codes that an item of the branch already has. */
export async function findTakenCodes(
  db: DbOrTx,
  branchId: number,
  codes: string[],
): Promise<string[]> {
  if (codes.length === 0) return [];
  const rows = await db
    .select({ code: items.code })
    .from(items)
    .where(and(eq(items.branchId, branchId), inArray(items.code, codes)));
  return rows.map((row) => row.code);
}

/** Those of these barcodes that an item of the branch already has. */
export async function findTakenBarcodes(
  db: DbOrTx,
  branchId: number,
  barcodes: string[],
): Promise<string[]> {
  if (barcodes.length === 0) return [];
  const rows = await db
    .select({ barcode: items.barcode })
    .from(items)
    .where(and(eq(items.branchId, branchId), inArray(items.barcode, barcodes)));
  return rows.flatMap((row) => (row.barcode === null ? [] : [row.barcode]));
}
