// Database queries for items — no business rules here (DreamLand §4). Every function takes the
// branch: items are branch-owned, so an item of another branch is simply not found.
import { schema, type DbOrTx } from '@ds/database';
import { and, asc, eq, getTableColumns, ilike, or, sql, type SQL } from 'drizzle-orm';

const { categories, items, itemStock } = schema;

export type ItemRow = typeof items.$inferSelect;
export type NewItemRow = typeof items.$inferInsert;
/** An item with the quantity of its item_stock row. */
export type ItemWithStock = ItemRow & { stock: number };
/** The fields an edit may change. */
export type ItemChanges = Partial<
  Pick<
    ItemRow,
    | 'code'
    | 'barcode'
    | 'name'
    | 'categoryId'
    | 'mrpPaise'
    | 'sellingPricePaise'
    | 'reorderLevel'
    | 'isActive'
  >
>;

const withStock = { ...getTableColumns(items), stock: itemStock.quantity };

/** Escape the characters LIKE treats as wildcards, so a search for "100%" means those characters. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}

/** Insert an item. A code or barcode the branch already has raises a unique violation. */
export async function insertItem(db: DbOrTx, values: NewItemRow): Promise<ItemRow> {
  const [row] = await db.insert(items).values(values).returning();
  return row!;
}

/** Give a new item its item_stock row, at 0. Later changes go through the stock ledger only. */
export async function insertStockRow(db: DbOrTx, itemId: number): Promise<void> {
  await db.insert(itemStock).values({ itemId, quantity: 0 });
}

/** Load an item of this branch and lock its row until the transaction ends. */
export async function findItemForUpdate(
  db: DbOrTx,
  branchId: number,
  id: number,
): Promise<ItemRow | undefined> {
  const [row] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, id), eq(items.branchId, branchId)))
    .limit(1)
    .for('update');
  return row;
}

/** Change fields of an item. */
export async function updateItem(db: DbOrTx, id: number, changes: ItemChanges): Promise<void> {
  await db.update(items).set(changes).where(eq(items.id, id));
}

/** An item of this branch (active or not) with its stock. */
export async function findItemWithStock(
  db: DbOrTx,
  branchId: number,
  id: number,
): Promise<ItemWithStock | undefined> {
  const [row] = await db
    .select(withStock)
    .from(items)
    .innerJoin(itemStock, eq(itemStock.itemId, items.id))
    .where(and(eq(items.id, id), eq(items.branchId, branchId)))
    .limit(1);
  return row;
}

/** The branch's active item with exactly this barcode, with its stock. */
export async function findActiveItemByBarcode(
  db: DbOrTx,
  branchId: number,
  barcode: string,
): Promise<ItemWithStock | undefined> {
  return findActiveItem(db, branchId, eq(items.barcode, barcode));
}

/** The branch's active item with exactly this code, with its stock. */
export async function findActiveItemByCode(
  db: DbOrTx,
  branchId: number,
  code: string,
): Promise<ItemWithStock | undefined> {
  return findActiveItem(db, branchId, eq(items.code, code));
}

async function findActiveItem(
  db: DbOrTx,
  branchId: number,
  match: SQL,
): Promise<ItemWithStock | undefined> {
  const [row] = await db
    .select(withStock)
    .from(items)
    .innerJoin(itemStock, eq(itemStock.itemId, items.id))
    .where(and(eq(items.branchId, branchId), eq(items.isActive, true), match))
    .limit(1);
  return row;
}

/**
 * One page of the branch's items by name (ignoring case), with stock and the total. `search`
 * matches any part of the name, code or barcode, ignoring case; the other filters are optional.
 */
export async function listItems(
  db: DbOrTx,
  branchId: number,
  query: { search?: string; categoryId?: number; active?: boolean; limit: number; offset: number },
): Promise<{ rows: ItemWithStock[]; total: number }> {
  const conditions: SQL[] = [eq(items.branchId, branchId)];
  if (query.search !== undefined) {
    const pattern = likePattern(query.search);
    conditions.push(
      or(ilike(items.name, pattern), ilike(items.code, pattern), ilike(items.barcode, pattern))!,
    );
  }
  if (query.categoryId !== undefined) {
    conditions.push(eq(items.categoryId, query.categoryId));
  }
  if (query.active !== undefined) {
    conditions.push(eq(items.isActive, query.active));
  }
  const where = and(...conditions);

  const rows = await db
    .select(withStock)
    .from(items)
    .innerJoin(itemStock, eq(itemStock.itemId, items.id))
    .where(where)
    .orderBy(sql`lower(${items.name})`, asc(items.id))
    .limit(query.limit)
    .offset(query.offset);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(items)
    .where(where);
  return { rows, total: count?.n ?? 0 };
}

/** Whether this category exists in this branch. */
export async function categoryInBranch(
  db: DbOrTx,
  branchId: number,
  categoryId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.branchId, branchId)))
    .limit(1);
  return row !== undefined;
}

/** Whether the branch has an item with exactly this code. */
export async function isCodeTaken(db: DbOrTx, branchId: number, code: string): Promise<boolean> {
  const [row] = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.branchId, branchId), eq(items.code, code)))
    .limit(1);
  return row !== undefined;
}
