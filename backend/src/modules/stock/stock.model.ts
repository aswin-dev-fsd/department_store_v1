// Database queries for the stock ledger — no business rules here (DreamLand §4). The writes take a
// transaction (`Tx`): the stock row lock only holds inside one. The reads at the end (Task 3.6)
// take any connection.
import { schema, type DbOrTx, type Tx } from '@ds/database';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

const { branches, items, itemStock, stockMovements, users } = schema;

export type NewMovement = typeof stockMovements.$inferInsert;

export interface LockedStock {
  itemId: number;
  name: string;
  quantity: number;
}

/**
 * Lock the stock rows of those of `itemIds` that belong to `branchId`, until the transaction
 * ends, and return them with the item name. One statement, ordered by item id, so two
 * transactions needing overlapping items always queue in the same order and cannot deadlock.
 * An item of another branch (or one that doesn't exist) is simply not returned.
 */
export async function lockStockRows(
  tx: Tx,
  branchId: number,
  itemIds: number[],
): Promise<LockedStock[]> {
  return tx
    .select({ itemId: itemStock.itemId, name: items.name, quantity: itemStock.quantity })
    .from(itemStock)
    .innerJoin(items, eq(items.id, itemStock.itemId))
    .where(and(inArray(itemStock.itemId, itemIds), eq(items.branchId, branchId)))
    .orderBy(asc(itemStock.itemId))
    .for('update', { of: itemStock });
}

/** Set several items' stock in one statement. The caller holds their row locks. */
export async function setStockQuantities(
  tx: Tx,
  rows: { itemId: number; quantity: number }[],
): Promise<void> {
  const values = sql.join(
    rows.map((row) => sql`(${row.itemId}::bigint, ${row.quantity}::integer)`),
    sql`, `,
  );
  await tx.execute(
    sql`update ${itemStock} as s set quantity = v.quantity
        from (values ${values}) as v(item_id, quantity)
        where s.item_id = v.item_id`,
  );
}

/** Append ledger rows. */
export async function insertMovements(tx: Tx, rows: NewMovement[]): Promise<void> {
  await tx.insert(stockMovements).values(rows);
}

// ---- Reads (Task 3.6): what the stock screens show. They never change stock. ----

/** One item with the quantity of its item_stock row. */
export interface StockLineRow {
  itemId: number;
  code: string;
  barcode: string | null;
  name: string;
  categoryId: number | null;
  quantity: number;
  reorderLevel: number | null;
  isActive: boolean;
}

type MovementRecord = typeof stockMovements.$inferSelect;

/** One ledger row with the name of the user who made it. */
export interface MovementRow {
  id: number;
  type: MovementRecord['type'];
  quantity: number;
  balanceAfter: number;
  refType: MovementRecord['refType'];
  refId: number | null;
  reason: MovementRecord['reason'];
  note: string | null;
  createdById: number;
  createdByName: string;
  createdAt: Date;
}

/** Whether this branch exists, active or not. */
export async function branchExists(db: DbOrTx, branchId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
  return row !== undefined;
}

/**
 * One page of the branch's items with their quantity, by name (ignoring case), and the total.
 * Active and inactive items alike: a deactivated item can still hold stock.
 */
export async function listStock(
  db: DbOrTx,
  branchId: number,
  query: { categoryId?: number; limit: number; offset: number },
): Promise<{ rows: StockLineRow[]; total: number }> {
  const where = and(
    eq(items.branchId, branchId),
    query.categoryId === undefined ? undefined : eq(items.categoryId, query.categoryId),
  );
  const rows = await db
    .select({
      itemId: items.id,
      code: items.code,
      barcode: items.barcode,
      name: items.name,
      categoryId: items.categoryId,
      quantity: itemStock.quantity,
      reorderLevel: items.reorderLevel,
      isActive: items.isActive,
    })
    .from(items)
    .innerJoin(itemStock, eq(itemStock.itemId, items.id))
    .where(where)
    .orderBy(sql`lower(${items.name})`, asc(items.id))
    .limit(query.limit)
    .offset(query.offset);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(items)
    .innerJoin(itemStock, eq(itemStock.itemId, items.id))
    .where(where);
  return { rows, total: count?.n ?? 0 };
}

/** Whether this item exists in this branch. */
export async function itemInBranch(
  db: DbOrTx,
  branchId: number,
  itemId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.branchId, branchId)))
    .limit(1);
  return row !== undefined;
}

/**
 * One page of an item's ledger rows in this branch, newest first, with the total. Ordered by row
 * id, not by time: the id is the order the stock lock applied the movements in, which is the
 * order `balance_after` follows.
 */
export async function listMovements(
  db: DbOrTx,
  branchId: number,
  itemId: number,
  query: { limit: number; offset: number },
): Promise<{ rows: MovementRow[]; total: number }> {
  const where = and(eq(stockMovements.itemId, itemId), eq(stockMovements.branchId, branchId));
  const rows = await db
    .select({
      id: stockMovements.id,
      type: stockMovements.type,
      quantity: stockMovements.quantity,
      balanceAfter: stockMovements.balanceAfter,
      refType: stockMovements.refType,
      refId: stockMovements.refId,
      reason: stockMovements.reason,
      note: stockMovements.note,
      createdById: stockMovements.createdBy,
      createdByName: users.fullName,
      createdAt: stockMovements.createdAt,
    })
    .from(stockMovements)
    .innerJoin(users, eq(users.id, stockMovements.createdBy))
    .where(where)
    .orderBy(desc(stockMovements.id))
    .limit(query.limit)
    .offset(query.offset);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(stockMovements)
    .where(where);
  return { rows, total: count?.n ?? 0 };
}
