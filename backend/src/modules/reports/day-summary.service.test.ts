// The day sales summary (Task 6.2): every number below is worked out by hand from the fixture.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import { createBranch, createItem, createUser, mapUser } from '../../../test/helpers/fixtures.js';
import { seedOpeningStock } from '../../../test/helpers/ledger.js';
import type { RequestContext } from '../../middleware/auth.js';
import { cancelBill, createBill } from '../bills/bills.service.js';
import type { DayTotals } from '@ds/shared';
import { daySummary } from './day-summary.service.js';

const { db, pool } = createTestDb();

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

const DAY = '2026-10-30';
const NEXT_DAY = '2026-10-31';

/** A session as the bill service sees it, for calling it directly with a chosen time. */
function contextFor(userId: number, fullName: string, branchId: number): RequestContext {
  return {
    user: { id: userId, username: 'u', fullName, role: 'cashier', mustChangePassword: false },
    activeBranchId: branchId,
    sessionId: 0,
    sessionToken: '',
  } as unknown as RequestContext;
}

/**
 * Two branches, two cashiers:
 * - Ravi works at TPR; Meena at TPR and CBE.
 * - TPR sells an item at ₹100.25 (so totals round), CBE one at ₹50.
 *
 * Bills, in IST:
 * 1. Ravi, TPR, 30 Oct 10:00 — 2 × ₹100.25 = ₹200.50, ₹0.50 off → ₹200.00 (round-off 0);
 *    paid cash ₹100 + UPI ₹60 + card ₹40.
 * 2. Ravi, TPR, 30 Oct 11:00 — 1 × ₹100.25 → ₹100.00 (round-off −0.25); UPI; then CANCELLED.
 * 3. Meena, TPR, 30 Oct 23:30 — 3 × ₹100.25 = ₹300.75 → ₹301.00 (round-off +0.25); cash.
 * 4. Meena, TPR, 31 Oct 00:10 — 1 × ₹100.25 → ₹100.00 (round-off −0.25); cash. The next day.
 * 5. Meena, CBE, 30 Oct 12:00 — 1 × ₹50 → ₹50.00; cash.
 */
async function fixture() {
  const tpr = await createBranch(pool, { code: 'TPR', name: 'Tiruppur' });
  const cbe = await createBranch(pool, { code: 'CBE', name: 'Coimbatore' });
  const ravi = await createUser(pool, { role: 'cashier', fullName: 'Ravi Kumar' });
  const meena = await createUser(pool, { role: 'cashier', fullName: 'Meena S' });
  await mapUser(pool, ravi, tpr);
  await mapUser(pool, meena, tpr);
  await mapUser(pool, meena, cbe);
  const tprItem = await createItem(pool, tpr, { mrpPaise: 11000, sellingPricePaise: 10025 });
  const cbeItem = await createItem(pool, cbe, { mrpPaise: 5000, sellingPricePaise: 5000 });
  await seedOpeningStock(pool, { branchId: tpr, itemId: tprItem, userId: ravi, quantity: 100 });
  await seedOpeningStock(pool, { branchId: cbe, itemId: cbeItem, userId: meena, quantity: 100 });

  const raviAtTpr = contextFor(ravi, 'Ravi Kumar', tpr);
  const meenaAtTpr = contextFor(meena, 'Meena S', tpr);
  const meenaAtCbe = contextFor(meena, 'Meena S', cbe);
  const sell = (
    ctx: RequestContext,
    branchId: number,
    itemId: number,
    quantity: number,
    discountPaise: number,
    payments: { mode: 'cash' | 'upi' | 'card'; amountPaise: number }[],
    at: string,
  ) =>
    createBill(
      db,
      ctx,
      branchId,
      { lines: [{ itemId, quantity, discountPaise }], payments },
      new Date(at),
      null,
    );

  const bill1 = await sell(
    raviAtTpr,
    tpr,
    tprItem,
    2,
    50,
    [
      { mode: 'cash', amountPaise: 10000 },
      { mode: 'upi', amountPaise: 6000 },
      { mode: 'card', amountPaise: 4000 },
    ],
    '2026-10-30T04:30:00Z',
  );
  const bill2 = await sell(
    raviAtTpr,
    tpr,
    tprItem,
    1,
    0,
    [{ mode: 'upi', amountPaise: 10000 }],
    '2026-10-30T05:30:00Z',
  );
  await cancelBill(db, raviAtTpr, tpr, bill2.id, { reason: 'Wrong item' }, null);
  const bill3 = await sell(
    meenaAtTpr,
    tpr,
    tprItem,
    3,
    0,
    [{ mode: 'cash', amountPaise: 30100 }],
    '2026-10-30T18:00:00Z',
  );
  const bill4 = await sell(
    meenaAtTpr,
    tpr,
    tprItem,
    1,
    0,
    [{ mode: 'cash', amountPaise: 10000 }],
    '2026-10-30T18:40:00Z',
  );
  const bill5 = await sell(
    meenaAtCbe,
    cbe,
    cbeItem,
    1,
    0,
    [{ mode: 'cash', amountPaise: 5000 }],
    '2026-10-30T06:30:00Z',
  );

  return { tpr, cbe, ravi, meena, bills: [bill1, bill2, bill3, bill4, bill5] };
}

function totals(
  values: Partial<DayTotals> & { payments?: Partial<DayTotals['payments']> },
): DayTotals {
  return {
    billCount: 0,
    subtotalPaise: 0,
    discountPaise: 0,
    roundOffPaise: 0,
    totalPaise: 0,
    cancelledCount: 0,
    cancelledPaise: 0,
    ...values,
    payments: { cash: 0, upi: 0, card: 0, ...values.payments },
  };
}

// The hand-worked figures for 30 October
const RAVI_TPR = totals({
  billCount: 1,
  subtotalPaise: 20050,
  discountPaise: 50,
  roundOffPaise: 0,
  totalPaise: 20000,
  payments: { cash: 10000, upi: 6000, card: 4000 },
  cancelledCount: 1,
  cancelledPaise: 10000,
});
const MEENA_TPR = totals({
  billCount: 1,
  subtotalPaise: 30075,
  roundOffPaise: 25,
  totalPaise: 30100,
  payments: { cash: 30100 },
});
const TPR = totals({
  billCount: 2,
  subtotalPaise: 50125,
  discountPaise: 50,
  roundOffPaise: 25,
  totalPaise: 50100,
  payments: { cash: 40100, upi: 6000, card: 4000 },
  cancelledCount: 1,
  cancelledPaise: 10000,
});
const MEENA_CBE = totals({
  billCount: 1,
  subtotalPaise: 5000,
  totalPaise: 5000,
  payments: { cash: 5000 },
});

describe('daySummary', () => {
  it('checks the fixture bills themselves first', async () => {
    const f = await fixture();
    expect(f.bills.map((bill) => [bill.billDate, bill.totalPaise, bill.roundOffPaise])).toEqual([
      [DAY, 20000, 0],
      [DAY, 10000, -25],
      [DAY, 30100, 25],
      [NEXT_DAY, 10000, -25],
      [DAY, 5000, 0],
    ]);
  });

  it('totals the day per cashier, per branch and overall, from hand-worked figures', async () => {
    const f = await fixture();

    const summary = await daySummary(db, { date: DAY });

    expect(summary).toEqual({
      date: DAY,
      totals: totals({
        billCount: 3,
        subtotalPaise: 55125,
        discountPaise: 50,
        roundOffPaise: 25,
        totalPaise: 55100,
        payments: { cash: 45100, upi: 6000, card: 4000 },
        cancelledCount: 1,
        cancelledPaise: 10000,
      }),
      branches: [
        {
          branch: { id: f.cbe, code: 'CBE', name: 'Coimbatore' },
          totals: MEENA_CBE,
          cashiers: [{ cashier: { id: f.meena, fullName: 'Meena S' }, totals: MEENA_CBE }],
        },
        {
          branch: { id: f.tpr, code: 'TPR', name: 'Tiruppur' },
          totals: TPR,
          cashiers: [
            { cashier: { id: f.meena, fullName: 'Meena S' }, totals: MEENA_TPR },
            { cashier: { id: f.ravi, fullName: 'Ravi Kumar' }, totals: RAVI_TPR },
          ],
        },
      ],
    });
  });

  it('keeps every total consistent: subtotal − discount + round-off = total = what was paid', async () => {
    await fixture();
    const { totals: day } = await daySummary(db, { date: DAY });
    expect(day.subtotalPaise - day.discountPaise + day.roundOffPaise).toBe(day.totalPaise);
    expect(day.payments.cash + day.payments.upi + day.payments.card).toBe(day.totalPaise);
  });

  it('puts a bill at 00:10 IST on the next day, and one at 23:30 IST on the same day', async () => {
    const f = await fixture();

    const next = await daySummary(db, { date: NEXT_DAY });

    expect(next.totals).toEqual(
      totals({
        billCount: 1,
        subtotalPaise: 10025,
        roundOffPaise: -25,
        totalPaise: 10000,
        payments: { cash: 10000 },
      }),
    );
    expect(
      next.branches.map((branch) => [branch.branch.id, branch.cashiers[0]!.cashier.id]),
    ).toEqual([[f.tpr, f.meena]]);
  });

  it('keeps a cancelled bill out of every total, and shows its count and value apart', async () => {
    const f = await fixture();
    const { branches } = await daySummary(db, { date: DAY, branchId: f.tpr, cashierId: f.ravi });
    const ravi = branches[0]!.cashiers[0]!.totals;
    expect(ravi.billCount).toBe(1);
    expect(ravi.payments.upi).toBe(6000); // the cancelled bill's ₹100 UPI is not counted
    expect([ravi.cancelledCount, ravi.cancelledPaise]).toEqual([1, 10000]);
  });

  it('narrows to one branch', async () => {
    const f = await fixture();
    const summary = await daySummary(db, { date: DAY, branchId: f.tpr });
    expect(summary.totals).toEqual(TPR);
    expect(summary.branches.map((branch) => branch.branch.code)).toEqual(['TPR']);
  });

  it('narrows to one cashier across branches (a cashier sees their own totals)', async () => {
    const f = await fixture();
    const summary = await daySummary(db, { date: DAY, cashierId: f.meena });
    expect(summary.branches.map((branch) => [branch.branch.code, branch.totals])).toEqual([
      ['CBE', MEENA_CBE],
      ['TPR', MEENA_TPR],
    ]);
    expect(summary.totals).toEqual(
      totals({
        billCount: 2,
        subtotalPaise: 35075,
        roundOffPaise: 25,
        totalPaise: 35100,
        payments: { cash: 35100 },
      }),
    );
  });

  it('narrows to one cashier in one branch', async () => {
    const f = await fixture();
    const summary = await daySummary(db, { date: DAY, branchId: f.tpr, cashierId: f.meena });
    expect(summary.totals).toEqual(MEENA_TPR);
  });

  it('answers zeros and no branches for a day without bills', async () => {
    await fixture();
    expect(await daySummary(db, { date: '2026-10-29' })).toEqual({
      date: '2026-10-29',
      totals: totals({}),
      branches: [],
    });
  });

  it('lists a cashier whose only bill that day was cancelled, with zero totals', async () => {
    const f = await fixture();
    // Cancel bill 1 too: Ravi now has only cancelled bills on the day
    await cancelBill(
      db,
      contextFor(f.ravi, 'Ravi Kumar', f.tpr),
      f.tpr,
      f.bills[0]!.id,
      {
        reason: 'Customer left',
      },
      null,
    );
    const summary = await daySummary(db, { date: DAY, cashierId: f.ravi });
    expect(summary.totals).toEqual(totals({ cancelledCount: 2, cancelledPaise: 30000 }));
  });
});
