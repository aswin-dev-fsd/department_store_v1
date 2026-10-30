// Report routes and who sees what (Task 6.6; D-22): a cashier their own day and their branch's
// stock, the Admin every report for any branch or all.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import {
  cookieFor,
  createBranch,
  createItem,
  createUser,
  createVendor,
  mapUser,
} from '../../../test/helpers/fixtures.js';
import { seedOpeningStock } from '../../../test/helpers/ledger.js';
import { createApp } from '../../app.js';
import type { RequestContext } from '../../middleware/auth.js';
import { createBill } from '../bills/bills.service.js';
import { createPurchase, postPurchase } from '../purchases/purchases.service.js';

const { db, pool } = createTestDb();
const app = createApp({ db });

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

const DAY = '2026-10-30';

function contextFor(userId: number, branchId: number): RequestContext {
  return {
    user: { id: userId, username: 'u', fullName: 'x', role: 'cashier', mustChangePassword: false },
    activeBranchId: branchId,
    sessionId: 0,
    sessionToken: '',
  } as unknown as RequestContext;
}

/**
 * TPR: Rice ₹100 (stock 50, reorder level 100, so low); CBE: Oil ₹50 (stock 50, no level).
 * Ravi works at TPR; Meena at TPR and CBE. Bills on 30 Oct (IST):
 * Ravi TPR 2 × Rice = ₹200; Meena TPR 1 × Rice = ₹100; Meena CBE 3 × Oil = ₹150.
 * One purchase posted at TPR: 10 × ₹80 = ₹800, invoice dated 15 Oct.
 */
async function fixture() {
  const tpr = await createBranch(pool, { code: 'TPR' });
  const cbe = await createBranch(pool, { code: 'CBE' });
  const ravi = await createUser(pool, { role: 'cashier', fullName: 'Ravi Kumar' });
  const meena = await createUser(pool, { role: 'cashier', fullName: 'Meena S' });
  const admin = await createUser(pool, { role: 'admin' });
  await mapUser(pool, ravi, tpr);
  await mapUser(pool, meena, tpr);
  await mapUser(pool, meena, cbe);
  const rice = await createItem(pool, tpr, {
    code: 'R10',
    name: 'Rice',
    mrpPaise: 10000,
    sellingPricePaise: 10000,
    reorderLevel: 100,
  });
  const oil = await createItem(pool, cbe, {
    code: 'O1',
    name: 'Oil',
    mrpPaise: 5000,
    sellingPricePaise: 5000,
  });
  await seedOpeningStock(pool, { branchId: tpr, itemId: rice, userId: ravi, quantity: 50 });
  await seedOpeningStock(pool, { branchId: cbe, itemId: oil, userId: meena, quantity: 50 });

  const at = new Date('2026-10-30T06:30:00Z');
  const sell = (
    userId: number,
    branchId: number,
    itemId: number,
    quantity: number,
    paise: number,
  ) =>
    createBill(
      db,
      contextFor(userId, branchId),
      branchId,
      {
        lines: [{ itemId, quantity, discountPaise: 0 }],
        payments: [{ mode: 'cash', amountPaise: paise }],
      },
      at,
      null,
    );
  await sell(ravi, tpr, rice, 2, 20000);
  await sell(meena, tpr, rice, 1, 10000);
  await sell(meena, cbe, oil, 3, 15000);

  const vendor = await createVendor(pool, tpr, { name: 'Arun Traders' });
  const draft = await createPurchase(
    db,
    contextFor(ravi, tpr),
    tpr,
    {
      vendorId: vendor,
      vendorInvoiceNo: 'INV-1',
      invoiceDate: '2026-10-15',
      lines: [{ itemId: rice, quantity: 10, costPricePaise: 8000 }],
    },
    null,
  );
  await postPurchase(db, contextFor(ravi, tpr), tpr, draft.id, null);

  return {
    tpr,
    cbe,
    ravi,
    meena,
    rice,
    oil,
    raviCookie: await cookieFor(db, ravi, tpr),
    meenaCookie: await cookieFor(db, meena, tpr),
    adminCookie: await cookieFor(db, admin),
  };
}

const get = (cookie: string, path: string) =>
  request(app).get(`/api/v1${path}`).set('Cookie', cookie);

describe('cashier: GET /reports/day-summary', () => {
  it('shows only their own bills in the branch they work in', async () => {
    const f = await fixture();

    const ravi = await get(f.raviCookie, `/reports/day-summary?date=${DAY}`);
    expect(ravi.status, JSON.stringify(ravi.body)).toBe(200);
    expect(ravi.body.data.totals).toMatchObject({ billCount: 1, totalPaise: 20000 });
    expect(ravi.body.data.branches).toHaveLength(1);
    expect(
      ravi.body.data.branches[0].cashiers.map((c: { cashier: { id: number } }) => c.cashier.id),
    ).toEqual([f.ravi]);

    // Meena, working at TPR: her TPR bill only, not her CBE one nor Ravi's
    const meena = await get(f.meenaCookie, `/reports/day-summary?date=${DAY}`);
    expect(meena.body.data.totals).toMatchObject({ billCount: 1, totalPaise: 10000 });
    expect(meena.body.data.branches[0].branch.id).toBe(f.tpr);
  });

  it('refuses a cashierId or branchId in the query (422), so nobody can widen it', async () => {
    const f = await fixture();
    for (const extra of [`cashierId=${f.meena}`, `branchId=${f.cbe}`]) {
      const res = await get(f.raviCookie, `/reports/day-summary?date=${DAY}&${extra}`);
      expect(res.status).toBe(422);
      expect(res.body.data).toBeUndefined();
    }
  });

  it.each([
    ['no date', ''],
    ['a malformed date', '?date=30-10-2026'],
    ['a day that does not exist', '?date=2026-02-30'],
  ])('answers 422 for %s', async (_label, query) => {
    const f = await fixture();
    expect((await get(f.raviCookie, `/reports/day-summary${query}`)).status).toBe(422);
  });
});

describe('cashier: GET /reports/stock and /reports/low-stock', () => {
  it('covers the branch they work in only', async () => {
    const f = await fixture();

    const stock = await get(f.raviCookie, '/reports/stock');
    expect(stock.status).toBe(200);
    expect(stock.body.data.items.map((row: { item: { id: number } }) => row.item.id)).toEqual([
      f.rice,
    ]);

    const low = await get(f.raviCookie, '/reports/low-stock');
    // 50 − 3 sold + 10 bought = 57, at or below the level of 100
    expect(low.body.data.items).toEqual([
      expect.objectContaining({ item: expect.objectContaining({ id: f.rice }), quantity: 57 }),
    ]);
  });

  it('refuses a branchId in the query (422)', async () => {
    const f = await fixture();
    expect((await get(f.raviCookie, `/reports/stock?branchId=${f.cbe}`)).status).toBe(422);
    expect((await get(f.raviCookie, `/reports/low-stock?branchId=${f.cbe}`)).status).toBe(422);
  });
});

describe('cashier: the other reports', () => {
  it('answers 403 for item-wise sales, the purchase register and every Admin report', async () => {
    const f = await fixture();
    for (const path of [
      `/admin/reports/item-sales?from=${DAY}&to=${DAY}`,
      `/admin/reports/purchase-register?from=${DAY}&to=${DAY}`,
      `/admin/reports/day-summary?date=${DAY}`,
      '/admin/reports/stock',
    ]) {
      const res = await get(f.raviCookie, path);
      expect([path, res.status, res.body.error.code]).toEqual([path, 403, 'FORBIDDEN']);
    }
  });

  it('has no cashier route for item-wise sales or the purchase register (404)', async () => {
    const f = await fixture();
    expect((await get(f.raviCookie, `/reports/item-sales?from=${DAY}&to=${DAY}`)).status).toBe(404);
    expect((await get(f.raviCookie, '/reports/purchase-register')).status).toBe(404);
  });

  it('answers 403 NO_ACTIVE_BRANCH before a branch is chosen, and 401 without a session', async () => {
    const f = await fixture();
    const noBranch = await cookieFor(db, f.meena, null);
    const res = await get(noBranch, `/reports/day-summary?date=${DAY}`);
    expect([res.status, res.body.error.code]).toEqual([403, 'NO_ACTIVE_BRANCH']);
    expect((await request(app).get(`/api/v1/reports/day-summary?date=${DAY}`)).status).toBe(401);
  });
});

describe('Admin: GET /admin/reports/:report', () => {
  it('day-summary: every branch without branchId; one branch or one cashier when named', async () => {
    const f = await fixture();

    const all = await get(f.adminCookie, `/admin/reports/day-summary?date=${DAY}`);
    expect(all.status).toBe(200);
    expect(all.body.data.totals).toMatchObject({ billCount: 3, totalPaise: 45000 });
    expect(all.body.data.branches.map((b: { branch: { code: string } }) => b.branch.code)).toEqual([
      'CBE',
      'TPR',
    ]);

    const tpr = await get(
      f.adminCookie,
      `/admin/reports/day-summary?date=${DAY}&branchId=${f.tpr}`,
    );
    expect(tpr.body.data.totals).toMatchObject({ billCount: 2, totalPaise: 30000 });

    const meena = await get(
      f.adminCookie,
      `/admin/reports/day-summary?date=${DAY}&cashierId=${f.meena}`,
    );
    expect(meena.body.data.totals).toMatchObject({ billCount: 2, totalPaise: 25000 });
  });

  it('item-sales: every branch, or one', async () => {
    const f = await fixture();
    const all = await get(f.adminCookie, `/admin/reports/item-sales?from=${DAY}&to=${DAY}`);
    expect(all.status).toBe(200);
    expect(
      all.body.data.items.map((row: { item: { code: string }; quantity: number }) => [
        row.item.code,
        row.quantity,
      ]),
    ).toEqual([
      ['R10', 3],
      ['O1', 3],
    ]);
    const cbe = await get(
      f.adminCookie,
      `/admin/reports/item-sales?from=${DAY}&to=${DAY}&branchId=${f.cbe}`,
    );
    expect(cbe.body.data.total).toBe(1);
  });

  it('stock and low-stock: every branch, or one', async () => {
    const f = await fixture();
    const all = await get(f.adminCookie, '/admin/reports/stock');
    expect(all.status).toBe(200);
    expect(all.body.data.total).toBe(2);
    const cbe = await get(f.adminCookie, `/admin/reports/stock?branchId=${f.cbe}`);
    expect(cbe.body.data.items.map((row: { item: { id: number } }) => row.item.id)).toEqual([
      f.oil,
    ]);
    const low = await get(f.adminCookie, '/admin/reports/low-stock');
    expect(low.body.data.items.map((row: { item: { id: number } }) => row.item.id)).toEqual([
      f.rice,
    ]);
  });

  it('purchase-register: every branch, or one', async () => {
    const f = await fixture();
    const all = await get(
      f.adminCookie,
      '/admin/reports/purchase-register?from=2026-10-01&to=2026-10-31',
    );
    expect(all.status).toBe(200);
    expect(all.body.data.totalPaise).toBe(80000);
    const cbe = await get(
      f.adminCookie,
      `/admin/reports/purchase-register?from=2026-10-01&to=2026-10-31&branchId=${f.cbe}`,
    );
    expect(cbe.body.data.totalPaise).toBe(0);
  });

  it('answers 404 for a branch that does not exist', async () => {
    const f = await fixture();
    expect((await get(f.adminCookie, '/admin/reports/stock?branchId=999999')).status).toBe(404);
  });

  it.each([
    ['an unknown report', '/admin/reports/profit?from=2026-10-01&to=2026-10-31'],
    ['a missing date', '/admin/reports/day-summary'],
    ['a day that does not exist', '/admin/reports/day-summary?date=2026-02-29'],
    ['a missing range', '/admin/reports/item-sales'],
    ['an end before the start', '/admin/reports/item-sales?from=2026-10-31&to=2026-10-01'],
    ['a range of 367 days', '/admin/reports/item-sales?from=2026-01-01&to=2027-01-02'],
    [
      'a range of 367 days (register)',
      '/admin/reports/purchase-register?from=2026-01-01&to=2027-01-02',
    ],
    ['a field a report does not take', '/admin/reports/stock?date=2026-10-30'],
  ])('answers 422 for %s', async (_label, path) => {
    const f = await fixture();
    expect((await get(f.adminCookie, path)).status).toBe(422);
  });

  it('accepts a range of exactly 366 days', async () => {
    const f = await fixture();
    // 2026-01-01 to 2027-01-01 counts both ends: 366 days
    const res = await get(f.adminCookie, '/admin/reports/item-sales?from=2026-01-01&to=2027-01-01');
    expect(res.status).toBe(200);
  });

  it("is refused the cashier's own-day route (403): the Admin has no counter day", async () => {
    const f = await fixture();
    const res = await get(f.adminCookie, `/reports/day-summary?date=${DAY}`);
    expect([res.status, res.body.error.code]).toEqual([403, 'FORBIDDEN']);
  });
});
