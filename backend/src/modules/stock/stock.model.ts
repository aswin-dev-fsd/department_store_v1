// Database queries for the stock ledger — no business rules here (DreamLand §4). Every function
// takes a transaction (`Tx`): the stock row lock only holds inside one.
import { schema, type Tx } from '@ds/database';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

const { items, itemStock, stockMovements } = schema;

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
