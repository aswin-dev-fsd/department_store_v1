// Item-wise sales (Task 6.3): every number below is worked out by hand from the fixture.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import { createBranch, createItem, createUser, mapUser } from '../../../test/helpers/fixtures.js';
import { seedOpeningStock } from '../../../test/helpers/ledger.js';
import type { RequestContext } from '../../middleware/auth.js';
import { cancelBill, createBill } from '../bills/bills.service.js';
import { daySummary } from './day-summary.service.js';
import { itemSales, ROUND_OFF_NOTE } from './item-sales.service.js';

const { db, pool } = createTestDb();

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

/** A session as the bill service sees it, for calling it directly with a chosen time. */
function contextFor(userId: number, branchId: number): RequestContext {
  return {
    user: {
      id: userId,
      username: 'u',
      fullName: 'Cashier',
      role: 'cashier',
      mustChangePassword: false,
    },
    activeBranchId: branchId,
    sessionId: 0,
    sessionToken: '',
  } as unknown as RequestContext;
}

/**
 * TPR sells Rice ₹100.25, Dal ₹50 and Soap ₹30; CBE sells Oil ₹80. Bills, in IST:
 * 1. TPR 29 Oct 10:00 — Rice × 1 → ₹100.25, total ₹100 (round-off −0.25)
 * 2. TPR 30 Oct 10:00 — Rice × 2 less ₹0.50 = ₹200, Dal × 3 = ₹150 → ₹350 (round-off 0)
 * 3. TPR 30 Oct 11:00 — Soap × 1 + Rice × 1 = ₹130.25 → ₹130 — then CANCELLED
 * 4. TPR 31 Oct 23:30 — Rice × 3 = ₹300.75 → ₹301 (round-off +0.25)
 * 5. TPR  1 Nov 00:10 — Dal × 1 = ₹50 (outside a 30–31 Oct range)
 * 6. CBE 30 Oct 12:00 — Oil × 2 = ₹160
 */
async function fixture() {
  const tpr = await createBranch(pool, { code: 'TPR' });
  const cbe = await createBranch(pool, { code: 'CBE' });
  const cashier = await createUser(pool, { role: 'cashier' });
  await mapUser(pool, cashier, tpr);
  await mapUser(pool, cashier, cbe);
  const item = async (branchId: number, code: string, name: string, pricePaise: number) => {
    const id = await createItem(pool, branchId, {
      code,
      name,
      mrpPaise: pricePaise,
      sellingPricePaise: pricePaise,
    });
    await seedOpeningStock(pool, { branchId, itemId: id, userId: cashier, quantity: 100 });
    return id;
  };
  const rice = await item(tpr, 'R10', 'Rice', 10025);
  const dal = await item(tpr, 'D1', 'Dal', 5000);
  const soap = await item(tpr, 'S1', 'Soap', 3000);
  const oil = await item(cbe, 'O1', 'Oil', 8000);

  const sell = (
    branchId: number,
    lines: { itemId: number; quantity: number; discountPaise?: number }[],
    totalPaise: number,
    at: string,
  ) =>
    createBill(
      db,
      contextFor(cashier, branchId),
      branchId,
      {
        lines: lines.map((line) => ({ discountPaise: 0, ...line })),
        payments: [{ mode: 'cash', amountPaise: totalPaise }],
      },
      new Date(at),
      null,
    );

  await sell(tpr, [{ itemId: rice, quantity: 1 }], 10000, '2026-10-29T04:30:00Z');
  await sell(
    tpr,
    [
      { itemId: rice, quantity: 2, discountPaise: 50 },
      { itemId: dal, quantity: 3 },
    ],
    35000,
    '2026-10-30T04:30:00Z',
  );
  const cancelled = await sell(
    tpr,
    [
      { itemId: soap, quantity: 1 },
      { itemId: rice, quantity: 1 },
    ],
    13000,
    '2026-10-30T05:30:00Z',
  );
  await cancelBill(
    db,
    contextFor(cashier, tpr),
    tpr,
    cancelled.id,
    { reason: 'Wrong items' },
    null,
  );
  await sell(tpr, [{ itemId: rice, quantity: 3 }], 30100, '2026-10-31T18:00:00Z');
  await sell(tpr, [{ itemId: dal, quantity: 1 }], 5000, '2026-10-31T18:40:00Z');
  await sell(cbe, [{ itemId: oil, quantity: 2 }], 16000, '2026-10-30T06:30:00Z');

  return { tpr, cbe, rice, dal, soap, oil };
}

const PAGE = { limit: 20, offset: 0 };

describe('itemSales', () => {
  it('sums packs and line totals per item over the range, highest value first, cancelled bills left out', async () => {
    const f = await fixture();

    const report = await itemSales(db, { from: '2026-10-30', to: '2026-10-31', ...PAGE });

    expect(report.items).toEqual([
      // 2 + 3 packs; ₹200 + ₹300.75
      {
        item: { id: f.rice, code: 'R10', name: 'Rice' },
        branch: { id: f.tpr, code: 'TPR' },
        quantity: 5,
        valuePaise: 50075,
      },
      {
        item: { id: f.oil, code: 'O1', name: 'Oil' },
        branch: { id: f.cbe, code: 'CBE' },
        quantity: 2,
        valuePaise: 16000,
      },
      {
        item: { id: f.dal, code: 'D1', name: 'Dal' },
        branch: { id: f.tpr, code: 'TPR' },
        quantity: 3,
        valuePaise: 15000,
      },
    ]);
    expect(report).toMatchObject({
      total: 3,
      limit: 20,
      offset: 0,
      from: '2026-10-30',
      to: '2026-10-31',
      itemsValuePaise: 81075,
      roundOffPaise: 25,
      billsTotalPaise: 81100,
      note: ROUND_OFF_NOTE,
    });
  });

  it('includes both ends of the range, by IST business date', async () => {
    const f = await fixture();

    const oneDay = await itemSales(db, { from: '2026-10-31', to: '2026-10-31', ...PAGE });
    expect(oneDay.items.map((row) => [row.item.id, row.quantity, row.valuePaise])).toEqual([
      [f.rice, 3, 30075], // 23:30 IST on the 31st counts; 00:10 IST on 1 Nov does not
    ]);

    const wider = await itemSales(db, { from: '2026-10-29', to: '2026-11-01', ...PAGE });
    expect(wider.items.map((row) => [row.item.code, row.quantity, row.valuePaise])).toEqual([
      ['R10', 6, 60100],
      ['D1', 4, 20000],
      ['O1', 2, 16000],
    ]);
  });

  it('narrows to one branch', async () => {
    const f = await fixture();
    const report = await itemSales(db, {
      from: '2026-10-30',
      to: '2026-10-31',
      branchId: f.tpr,
      ...PAGE,
    });
    expect(report.items.map((row) => row.item.code)).toEqual(['R10', 'D1']);
    expect(report).toMatchObject({
      total: 2,
      itemsValuePaise: 65075,
      roundOffPaise: 25,
      billsTotalPaise: 65100,
    });
  });

  it('pages through the items in the same order', async () => {
    await fixture();
    const range = { from: '2026-10-30', to: '2026-10-31' };
    const first = await itemSales(db, { ...range, limit: 2, offset: 0 });
    const second = await itemSales(db, { ...range, limit: 2, offset: 2 });
    expect(first.items.map((row) => row.item.code)).toEqual(['R10', 'O1']);
    expect(second.items.map((row) => row.item.code)).toEqual(['D1']);
    expect([first.total, second.total]).toEqual([3, 3]);
    // The range totals cover every page, not just the one shown
    expect(second.itemsValuePaise).toBe(81075);
  });

  it('differs from the day summary total by exactly the summed round-off', async () => {
    await fixture();
    const days = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'];
    const summaries = await Promise.all(days.map((date) => daySummary(db, { date })));
    const billsTotal = summaries.reduce((sum, day) => sum + day.totals.totalPaise, 0);
    const roundOff = summaries.reduce((sum, day) => sum + day.totals.roundOffPaise, 0);

    const report = await itemSales(db, { from: days[0]!, to: days.at(-1)!, ...PAGE });

    // ₹100 + ₹350 + ₹160 + ₹301 + ₹50 = ₹961 in bills; round-off −0.25 + 0.25 = 0
    expect(billsTotal).toBe(96100);
    expect(report.billsTotalPaise).toBe(billsTotal);
    expect(billsTotal - report.itemsValuePaise).toBe(roundOff);
    expect(report.roundOffPaise).toBe(roundOff);

    // On the 30th–31st alone the round-off is +0.25, and so is the difference
    const [, thirtieth, thirtyFirst] = summaries;
    const twoDays = await itemSales(db, { from: '2026-10-30', to: '2026-10-31', ...PAGE });
    const twoDaysTotal = thirtieth!.totals.totalPaise + thirtyFirst!.totals.totalPaise;
    expect(twoDaysTotal - twoDays.itemsValuePaise).toBe(25);
  });

  it('answers an empty page and zeros for a range without sales', async () => {
    await fixture();
    expect(await itemSales(db, { from: '2026-09-01', to: '2026-09-30', ...PAGE })).toMatchObject({
      items: [],
      total: 0,
      itemsValuePaise: 0,
      roundOffPaise: 0,
      billsTotalPaise: 0,
    });
  });
});
