// The stock ledger service (Task 3.2): the only code that changes stock. Real database, real
// transactions: the point is to prove that stock and the ledger never disagree, even under
// concurrency.
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createBranch, createItem, createUser } from '../../../test/helpers/fixtures.js';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import {
  assertLedgerMatchesStock,
  movementCount,
  seedOpeningStock,
  stockOf,
} from '../../../test/helpers/ledger.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { postMovements, type MovementInput } from './stock.service.js';

const { db, pool } = createTestDb();

let branchId: number;
let otherBranchId: number;
let userId: number;

beforeEach(async () => {
  await resetDb(db);
  branchId = await createBranch(pool);
  otherBranchId = await createBranch(pool);
  userId = await createUser(pool);
});

afterAll(async () => {
  await pool.end();
});

const sale = (itemId: number, quantity: number): MovementInput => ({
  itemId,
  quantity,
  type: 'sale',
  refType: 'bill',
  refId: 1,
});

const purchase = (itemId: number, quantity: number): MovementInput => ({
  itemId,
  quantity,
  type: 'purchase',
  refType: 'purchase',
  refId: 1,
});

/** Post in its own transaction, as a bill or purchase service would. */
const post = (movements: MovementInput[], branch = branchId) =>
  db.transaction((tx) => postMovements(tx, { branchId: branch, userId, movements }));

/**
 * Post inside a transaction that COMMITS even though the call throws, and hand back what it
 * threw. If the service wrote anything before failing, that write is committed here and the
 * test sees it: so "nothing written" really means the service checked before it wrote.
 */
const postAndCatch = (movements: MovementInput[], branch = branchId): Promise<unknown> =>
  db.transaction((tx) =>
    postMovements(tx, { branchId: branch, userId, movements }).then(
      () => undefined,
      (error: unknown) => error,
    ),
  );

async function itemWithStock(quantity: number, name?: string, branch = branchId): Promise<number> {
  const itemId = await createItem(pool, branch, name ? { name } : {});
  if (quantity > 0) await seedOpeningStock(pool, { branchId: branch, itemId, userId, quantity });
  return itemId;
}

describe('postMovements', () => {
  it('adds stock: +5 on an empty item gives stock 5 and one ledger row with balance 5', async () => {
    const item = await itemWithStock(0);
    const result = await post([purchase(item, 5)]);

    expect(result).toEqual([{ itemId: item, balanceAfter: 5 }]);
    expect(await stockOf(pool, item)).toBe(5);
    const { rows } = await pool.query(
      `select branch_id, item_id, type, quantity, balance_after, ref_type, ref_id, created_by
         from stock_movements where item_id = $1`,
      [item],
    );
    expect(rows).toEqual([
      {
        branch_id: String(branchId),
        item_id: String(item),
        type: 'purchase',
        quantity: 5,
        balance_after: 5,
        ref_type: 'purchase',
        ref_id: '1',
        created_by: String(userId),
      },
    ]);
    await assertLedgerMatchesStock(pool, item);
  });

  it('removes stock: -2 gives stock 3 and balance 3', async () => {
    const item = await itemWithStock(5);
    const result = await post([sale(item, -2)]);

    expect(result).toEqual([{ itemId: item, balanceAfter: 3 }]);
    expect(await stockOf(pool, item)).toBe(3);
    expect(await movementCount(pool, item)).toBe(2);
    await assertLedgerMatchesStock(pool, item);
  });

  it('refuses to go below zero: -10 on stock 3 throws INSUFFICIENT_STOCK and writes nothing', async () => {
    const item = await itemWithStock(3, 'Rice 10 kg');
    const error = await postAndCatch([sale(item, -10)]);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      statusCode: 400,
      details: [{ itemId: item, name: 'Rice 10 kg', available: 3, requested: 10 }],
    });
    expect(await stockOf(pool, item)).toBe(3);
    expect(await movementCount(pool, item)).toBe(1);
    await assertLedgerMatchesStock(pool, item);
  });

  it('is all or nothing: one insufficient item in a call writes nothing for any item', async () => {
    const a = await itemWithStock(5, 'Item A');
    const b = await itemWithStock(2, 'Item B');
    const c = await itemWithStock(9, 'Item C');
    const error = await postAndCatch([sale(a, -1), sale(b, -3), sale(c, -2)]);

    expect(error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: [{ itemId: b, name: 'Item B', available: 2, requested: 3 }],
    });
    for (const [item, stock] of [
      [a, 5],
      [b, 2],
      [c, 9],
    ] as const) {
      expect(await stockOf(pool, item)).toBe(stock);
      expect(await movementCount(pool, item)).toBe(1);
      await assertLedgerMatchesStock(pool, item);
    }
  });

  it('lists every item that is short, not just the first', async () => {
    const a = await itemWithStock(1, 'Item A');
    const b = await itemWithStock(0, 'Item B');
    const error = await postAndCatch([sale(a, -2), sale(b, -1)]);

    expect(error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: [
        { itemId: a, name: 'Item A', available: 1, requested: 2 },
        { itemId: b, name: 'Item B', available: 0, requested: 1 },
      ],
    });
  });

  it('checks the same item twice in one call against the combined quantity', async () => {
    const item = await itemWithStock(5, 'Rice 10 kg');

    // Two bill lines of 3: each fits on its own, together they do not
    const error = await postAndCatch([sale(item, -3), sale(item, -3)]);
    expect(error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: [{ itemId: item, name: 'Rice 10 kg', available: 5, requested: 6 }],
    });
    expect(await stockOf(pool, item)).toBe(5);
    expect(await movementCount(pool, item)).toBe(1);

    // Two lines that fit together: one ledger row per line, balances in order
    const result = await post([sale(item, -2), sale(item, -3)]);
    expect(result).toEqual([
      { itemId: item, balanceAfter: 3 },
      { itemId: item, balanceAfter: 0 },
    ]);
    expect(await stockOf(pool, item)).toBe(0);
    expect(await movementCount(pool, item)).toBe(3);
    await assertLedgerMatchesStock(pool, item);
  });

  it('never lets a mixed call dip below zero on the way, even if it ends above', async () => {
    const item = await itemWithStock(3);
    // Applied in order this would go 3 -> -5 -> 0: a ledger row would record balance -5
    const error = await postAndCatch([sale(item, -8), purchase(item, 5)]);
    expect(error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: [{ itemId: item, available: 3, requested: 8 }],
    });
    expect(await stockOf(pool, item)).toBe(3);
    await assertLedgerMatchesStock(pool, item);
  });

  it("refuses an item from another branch with NotFoundError and writes nothing, even for this branch's items", async () => {
    const mine = await itemWithStock(4, 'Mine');
    const foreign = await itemWithStock(4, 'Foreign', otherBranchId);
    const error = await postAndCatch([purchase(mine, 1), sale(foreign, -1)]);

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({ statusCode: 404 });
    for (const item of [mine, foreign]) {
      expect(await stockOf(pool, item)).toBe(4);
      expect(await movementCount(pool, item)).toBe(1);
      await assertLedgerMatchesStock(pool, item);
    }
  });

  it('refuses an item that does not exist with NotFoundError', async () => {
    const error = await postAndCatch([purchase(999999, 1)]);
    expect(error).toBeInstanceOf(NotFoundError);
  });

  it.each([
    ['zero', 0],
    ['a fraction', 1.5],
    ['not a number', Number.NaN],
  ])(
    'refuses a quantity that is %s (INVALID_MOVEMENT) and writes nothing',
    async (_label, quantity) => {
      const item = await itemWithStock(2);
      const error = await postAndCatch([purchase(item, quantity)]);

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'INVALID_MOVEMENT', statusCode: 400 });
      expect(await stockOf(pool, item)).toBe(2);
      expect(await movementCount(pool, item)).toBe(1);
    },
  );

  it('does nothing for an empty list', async () => {
    await expect(post([])).resolves.toEqual([]);
  });

  it('still moves an inactive item, so a cancelled bill can put its stock back', async () => {
    const item = await createItem(pool, branchId, { isActive: false });
    await expect(post([purchase(item, 2)])).resolves.toEqual([{ itemId: item, balanceAfter: 2 }]);
    await assertLedgerMatchesStock(pool, item);
  });

  it('records the optional fields: reason, note, batch and expiry', async () => {
    const item = await itemWithStock(5);
    await post([
      {
        itemId: item,
        quantity: -1,
        type: 'adjustment',
        refType: 'adjustment',
        reason: 'damage',
        note: 'bag torn',
        batchNo: 'B-7',
        expiryDate: '2027-03-31',
      },
    ]);
    const { rows } = await pool.query(
      `select reason, note, batch_no, expiry_date::text as expiry_date, ref_id
         from stock_movements where item_id = $1 and type = 'adjustment'`,
      [item],
    );
    expect(rows).toEqual([
      {
        reason: 'damage',
        note: 'bag torn',
        batch_no: 'B-7',
        expiry_date: '2027-03-31',
        ref_id: null,
      },
    ]);
  });
});

describe('postMovements under concurrency', () => {
  it('lets exactly one of two parallel sales of the last unit succeed', async () => {
    const item = await itemWithStock(1);

    const run = () =>
      db.transaction(async (tx) => {
        const result = await postMovements(tx, {
          branchId,
          userId,
          movements: [sale(item, -1)],
        });
        // Hold the lock for a moment before committing, so the other sale certainly overlaps it
        await tx.execute(sql`select pg_sleep(0.3)`);
        return result;
      });
    const outcomes = await Promise.allSettled([run(), run()]);

    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(await stockOf(pool, item)).toBe(0);
    await assertLedgerMatchesStock(pool, item);
  });

  it('keeps every unit and every balance when 20 purchases arrive at once', async () => {
    const item = await itemWithStock(0);

    const results = await Promise.all(Array.from({ length: 20 }, () => post([purchase(item, 1)])));

    const balances = results.map(([posted]) => posted!.balanceAfter).sort((a, b) => a - b);
    expect(balances).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(await stockOf(pool, item)).toBe(20);
    expect(await movementCount(pool, item)).toBe(20);
    await assertLedgerMatchesStock(pool, item);
  });
});

describe('assertLedgerMatchesStock', () => {
  it('fails when stock and ledger disagree, so the invariant check cannot pass by accident', async () => {
    const item = await itemWithStock(5);
    await assertLedgerMatchesStock(pool, item);

    await pool.query('update item_stock set quantity = 6 where item_id = $1', [item]);
    await expect(assertLedgerMatchesStock(pool, item)).rejects.toThrow();
  });

  it('fails when a row records the wrong balance', async () => {
    const item = await itemWithStock(5);
    await pool.query('update stock_movements set balance_after = 9 where item_id = $1', [item]);
    await expect(assertLedgerMatchesStock(pool, item)).rejects.toThrow();
  });
});
