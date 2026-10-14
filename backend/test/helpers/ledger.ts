// Test helpers for the stock ledger (Task 3.2). They read and write the test database directly, so
// a test can set up stock and check the ledger's invariant without going through the service
// under test.
import type { DbHandle } from '@ds/database';
import { expect } from 'vitest';

type Pool = DbHandle['pool'];

/**
 * Give an item its opening stock the way an import would: an `opening` movement and the matching
 * item_stock quantity, so the item starts with a consistent ledger. Written with SQL, not the
 * service, so the service's own tests don't depend on the service to set up.
 */
export async function seedOpeningStock(
  pool: Pool,
  {
    branchId,
    itemId,
    userId,
    quantity,
  }: { branchId: number; itemId: number; userId: number; quantity: number },
): Promise<void> {
  await pool.query(
    `insert into stock_movements (branch_id, item_id, type, quantity, balance_after, ref_type, created_by)
     values ($1, $2, 'opening', $3, $3, 'import', $4)`,
    [branchId, itemId, quantity, userId],
  );
  await pool.query('update item_stock set quantity = $2 where item_id = $1', [itemId, quantity]);
}

/** The item's current stock, as a number. */
export async function stockOf(pool: Pool, itemId: number): Promise<number> {
  const { rows } = await pool.query<{ quantity: number }>(
    'select quantity from item_stock where item_id = $1',
    [itemId],
  );
  return Number(rows[0]!.quantity);
}

/** How many ledger rows an item has. */
export async function movementCount(pool: Pool, itemId: number): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    'select count(*) as n from stock_movements where item_id = $1',
    [itemId],
  );
  return Number(rows[0]!.n);
}

/**
 * The ledger's invariant (D-02): the item's stock equals the sum of its movements, and every
 * row's balance_after equals the running total up to that row. Call it at the end of every test
 * that moves stock; a lost update, a half-applied call or a wrong balance all show up here.
 */
export async function assertLedgerMatchesStock(pool: Pool, itemId: number): Promise<void> {
  const { rows } = await pool.query<{ quantity: number; balance_after: number }>(
    'select quantity, balance_after from stock_movements where item_id = $1 order by id',
    [itemId],
  );
  let running = 0;
  const balances: number[] = [];
  for (const row of rows) {
    running += Number(row.quantity);
    balances.push(running);
  }
  expect(
    rows.map((row) => Number(row.balance_after)),
    `balance_after of item ${itemId} must equal the running total of its movements`,
  ).toEqual(balances);
  expect(
    await stockOf(pool, itemId),
    `item_stock of item ${itemId} must equal the sum of its movements`,
  ).toBe(running);
}
