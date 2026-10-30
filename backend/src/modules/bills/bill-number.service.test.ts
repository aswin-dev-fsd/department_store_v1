// Bill number allocation (Task 5.3): per branch and year, gapless, safe across counters.
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import { createBranch } from '../../../test/helpers/fixtures.js';
import { allocateBillSeq } from './bill-number.service.js';

const { db, pool } = createTestDb();

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

/** One committed allocation, as a bill that saves would make. */
function allocate(branchId: number, fy = '26-27'): Promise<number> {
  return db.transaction((tx) => allocateBillSeq(tx, branchId, fy));
}

async function lastSeq(branchId: number, fy = '26-27'): Promise<number | null> {
  const { rows } = await pool.query<{ last_seq: number }>(
    'select last_seq from bill_sequences where branch_id = $1 and fy = $2',
    [branchId, fy],
  );
  return rows[0]?.last_seq ?? null;
}

describe('allocateBillSeq', () => {
  it('starts a branch and year at 1, then counts up', async () => {
    const branch = await createBranch(pool);
    expect([await allocate(branch), await allocate(branch), await allocate(branch)]).toEqual([
      1, 2, 3,
    ]);
    expect(await lastSeq(branch)).toBe(3);
  });

  it('starts again at 1 in a new financial year, keeping the old year as it was', async () => {
    const branch = await createBranch(pool);
    await allocate(branch, '26-27');
    await allocate(branch, '26-27');
    expect(await allocate(branch, '27-28')).toBe(1);
    expect(await lastSeq(branch, '26-27')).toBe(2);
  });

  it('gives each branch its own sequence', async () => {
    const tpr = await createBranch(pool);
    const cbe = await createBranch(pool);
    await allocate(tpr);
    await allocate(tpr);
    expect(await allocate(cbe)).toBe(1);
    expect(await allocate(tpr)).toBe(3);
  });

  it('leaves no gap when a bill fails: a rolled-back number is reused', async () => {
    const branch = await createBranch(pool);
    expect(await allocate(branch)).toBe(1);

    let taken: number | null = null;
    await expect(
      db.transaction(async (tx) => {
        taken = await allocateBillSeq(tx, branch, '26-27');
        throw new Error('the bill failed after taking its number');
      }),
    ).rejects.toThrow('the bill failed');
    expect(taken).toBe(2);

    expect(await allocate(branch)).toBe(2);
    expect(await lastSeq(branch)).toBe(2);
  });

  it('leaves no row behind when the very first bill of a year fails', async () => {
    const branch = await createBranch(pool);
    await expect(
      db.transaction(async (tx) => {
        await allocateBillSeq(tx, branch, '26-27');
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    expect(await lastSeq(branch)).toBeNull();
    expect(await allocate(branch)).toBe(1);
  });
});

describe('allocateBillSeq under concurrency', () => {
  // "Done when": this passes 10 runs in a row; the loop is those runs
  it.each(Array.from({ length: 10 }, (_, run) => run + 1))(
    'gives 50 parallel bills exactly 1–50, no duplicates and no gaps (run %i)',
    async () => {
      const branch = await createBranch(pool);

      const numbers = await Promise.all(
        Array.from({ length: 50 }, () =>
          db.transaction(async (tx) => {
            const seq = await allocateBillSeq(tx, branch, '26-27');
            // Hold the row lock a moment, as a real bill's inserts would, so the others queue
            await tx.execute(sql`select pg_sleep(0.01)`);
            return seq;
          }),
        ),
      );

      expect([...numbers].sort((a, b) => a - b)).toEqual(
        Array.from({ length: 50 }, (_, index) => index + 1),
      );
      expect(await lastSeq(branch)).toBe(50);
    },
  );

  it('keeps the numbers gapless when some of the parallel bills fail', async () => {
    const branch = await createBranch(pool);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        db.transaction(async (tx) => {
          const seq = await allocateBillSeq(tx, branch, '26-27');
          if (index % 4 === 0) throw new Error('this bill fails');
          return seq;
        }),
      ),
    );

    const saved = outcomes
      .filter((outcome): outcome is PromiseFulfilledResult<number> => outcome.status === 'fulfilled')
      .map((outcome) => outcome.value)
      .sort((a, b) => a - b);
    expect(saved).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
    expect(await lastSeq(branch)).toBe(15);
  });
});
