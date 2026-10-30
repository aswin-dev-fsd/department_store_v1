// Cancelling a posted purchase (Task 4.4): stock back out through the ledger, unless it has been
// sold; prices stay; the invoice can be entered again.
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { expectAudit } from '../../../test/helpers/audit.js';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import {
  cookieFor,
  createBranch,
  createItem,
  createUser,
  createVendor,
  mapUser,
} from '../../../test/helpers/fixtures.js';
import { assertLedgerMatchesStock, stockOf } from '../../../test/helpers/ledger.js';
import { createApp } from '../../app.js';
import { postMovements } from '../stock/stock.service.js';

const { db, pool } = createTestDb();
const app = createApp({ db });
const URL = '/api/v1/purchases';

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

interface Counter {
  userId: number;
  branchId: number;
  cookie: string;
  vendorId: number;
  rice: number;
  dal: number;
}

/** A cashier in a new branch with a vendor and two items (MRP ₹100, selling price ₹90). */
async function counter(): Promise<Counter> {
  const branchId = await createBranch(pool);
  const userId = await createUser(pool, { role: 'cashier', fullName: 'Ravi Kumar' });
  await mapUser(pool, userId, branchId);
  const vendorId = await createVendor(pool, branchId, { name: 'Sri Traders' });
  const rice = await createItem(pool, branchId, { code: 'R10', name: 'Rice 10 kg' });
  const dal = await createItem(pool, branchId, { code: 'D1', name: 'Toor Dal 1 kg' });
  return { userId, branchId, cookie: await cookieFor(db, userId, branchId), vendorId, rice, dal };
}

type Body = Record<string, unknown>;

function line(itemId: number, quantity: number, extra: Body = {}): Body {
  return { itemId, quantity, costPricePaise: 100, ...extra };
}

function draftBody(c: Counter, lines: Body[], invoice = 'INV-2231'): Body {
  return { vendorId: c.vendorId, vendorInvoiceNo: invoice, invoiceDate: '2026-10-28', lines };
}

/** Create a draft through the API and return its id. */
async function draft(c: Counter, lines: Body[], invoice?: string): Promise<number> {
  const res = await request(app)
    .post(URL)
    .set('Cookie', c.cookie)
    .send(draftBody(c, lines, invoice));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id as number;
}

/** Create and post a purchase through the API and return its id. */
async function posted(c: Counter, lines: Body[], invoice?: string): Promise<number> {
  const id = await draft(c, lines, invoice);
  const res = await request(app).post(`${URL}/${id}/post`).set('Cookie', c.cookie);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return id;
}

function cancel(cookie: string, id: number, body: Body = { reason: 'Wrong vendor invoice' }) {
  return request(app).post(`${URL}/${id}/cancel`).set('Cookie', cookie).send(body);
}

/** Sell stock the way billing will (Phase 5): a `sale` movement through the ledger. */
async function sell(c: Counter, itemId: number, quantity: number): Promise<void> {
  await db.transaction((tx) =>
    postMovements(tx, {
      branchId: c.branchId,
      userId: c.userId,
      movements: [{ itemId, quantity: -quantity, type: 'sale', refType: 'bill', refId: 1 }],
    }),
  );
}

async function storedPurchase(id: number) {
  const { rows } = await pool.query(
    `select status, cancelled_by, cancelled_at is not null as has_cancelled_at, cancel_reason
       from purchases where id = $1`,
    [id],
  );
  const row = rows[0];
  return {
    status: row.status as string,
    cancelledBy: row.cancelled_by === null ? null : Number(row.cancelled_by),
    hasCancelledAt: row.has_cancelled_at as boolean,
    cancelReason: row.cancel_reason as string | null,
  };
}

async function cancelMovements(purchaseId: number) {
  const { rows } = await pool.query(
    `select item_id, quantity from stock_movements
      where type = 'purchase_cancel' and ref_type = 'purchase' and ref_id = $1 order by id`,
    [purchaseId],
  );
  return rows.map((row) => ({ itemId: Number(row.item_id), quantity: Number(row.quantity) }));
}

async function auditCount(action: string): Promise<number> {
  const { rows } = await pool.query('select 1 from audit_logs where action = $1', [action]);
  return rows.length;
}

describe('access control', () => {
  it('answers 401 without a session', async () => {
    expect((await request(app).post(`${URL}/1/cancel`)).status).toBe(401);
  });

  it('refuses an Admin with 403 FORBIDDEN, and cancels nothing', async () => {
    const c = await counter();
    const id = await posted(c, [line(c.rice, 5)]);
    const admin = await cookieFor(db, await createUser(pool, { role: 'admin' }));

    const res = await cancel(admin, id);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect((await storedPurchase(id)).status).toBe('posted');
    expect(await stockOf(pool, c.rice)).toBe(5);
  });

  it('asks a cashier without a chosen branch to choose one (403 NO_ACTIVE_BRANCH)', async () => {
    const cookie = await cookieFor(db, await createUser(pool, { role: 'cashier' }), null);
    const res = await cancel(cookie, 1);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NO_ACTIVE_BRANCH');
  });
});

describe('POST /purchases/:id/cancel', () => {
  it('cancels a posted purchase: stock back to before, one purchase_cancel per line, audited', async () => {
    const c = await counter();
    const id = await posted(c, [line(c.rice, 24), line(c.dal, 6)]);

    const res = await cancel(c.cookie, id, { reason: '  Wrong vendor invoice ' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id,
      status: 'cancelled',
      cancelledBy: { id: c.userId, fullName: 'Ravi Kumar' },
      cancelReason: 'Wrong vendor invoice',
    });
    expect(typeof res.body.data.cancelledAt).toBe('string');
    expect(await storedPurchase(id)).toEqual({
      status: 'cancelled',
      cancelledBy: c.userId,
      hasCancelledAt: true,
      cancelReason: 'Wrong vendor invoice',
    });
    expect(await stockOf(pool, c.rice)).toBe(0);
    expect(await stockOf(pool, c.dal)).toBe(0);
    expect(await cancelMovements(id)).toEqual([
      { itemId: c.rice, quantity: -24 },
      { itemId: c.dal, quantity: -6 },
    ]);
    await assertLedgerMatchesStock(pool, c.rice);
    await assertLedgerMatchesStock(pool, c.dal);

    const audit = await expectAudit(db, {
      action: 'purchase.cancel',
      entity: 'purchase',
      entityId: id,
      actorId: c.userId,
    });
    expect(audit.before).toEqual({ status: 'posted' });
    expect(audit.after).toEqual({ status: 'cancelled', reason: 'Wrong vendor invoice' });
  });

  it('works while part of the stock is sold, as long as enough of it is left', async () => {
    const c = await counter();
    await posted(c, [line(c.rice, 10)]);
    const second = await posted(c, [line(c.rice, 5)], 'INV-2');
    await sell(c, c.rice, 8);

    expect((await cancel(c.cookie, second)).status).toBe(200);
    expect(await stockOf(pool, c.rice)).toBe(2);
    await assertLedgerMatchesStock(pool, c.rice);
  });
});

describe('reason', () => {
  it.each([
    ['missing', {}],
    ['blank', { reason: '   ' }],
    ['shorter than 3 characters', { reason: 'ab' }],
    ['longer than 200 characters', { reason: 'x'.repeat(201) }],
  ])('refuses a reason that is %s with 422, and cancels nothing', async (_label, body) => {
    const c = await counter();
    const id = await posted(c, [line(c.rice, 5)]);

    const res = await cancel(c.cookie, id, body);

    expect(res.status).toBe(422);
    expect(res.body.error.details[0].path).toBe('body.reason');
    expect((await storedPurchase(id)).status).toBe('posted');
    expect(await stockOf(pool, c.rice)).toBe(5);
  });

  it('accepts a reason of exactly 3 characters', async () => {
    const c = await counter();
    const id = await posted(c, [line(c.rice, 5)]);
    expect((await cancel(c.cookie, id, { reason: 'Dup' })).status).toBe(200);
  });
});

describe('stock already sold', () => {
  it('refuses with 400 INSUFFICIENT_STOCK listing the items, and changes nothing', async () => {
    const c = await counter();
    const id = await posted(c, [line(c.rice, 10), line(c.dal, 4)]);
    await sell(c, c.rice, 3);

    const res = await cancel(c.cookie, id);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.details).toEqual([
      { itemId: c.rice, name: 'Rice 10 kg', available: 7, requested: 10 },
    ]);
    expect(await storedPurchase(id)).toMatchObject({ status: 'posted', cancelReason: null });
    expect(await stockOf(pool, c.rice)).toBe(7);
    expect(await stockOf(pool, c.dal)).toBe(4);
    expect(await cancelMovements(id)).toEqual([]);
    expect(await auditCount('purchase.cancel')).toBe(0);
    await assertLedgerMatchesStock(pool, c.rice);
    await assertLedgerMatchesStock(pool, c.dal);
  });
});

describe('wrong state', () => {
  it('refuses to cancel a draft with 400 DOCUMENT_LOCKED: drafts are just edited', async () => {
    const c = await counter();
    const id = await draft(c, [line(c.rice, 5)]);

    const res = await cancel(c.cookie, id);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DOCUMENT_LOCKED');
    expect((await storedPurchase(id)).status).toBe('draft');
  });

  it('refuses to cancel twice with 400 DOCUMENT_LOCKED, taking no more stock', async () => {
    const c = await counter();
    const id = await posted(c, [line(c.rice, 5)]);
    expect((await cancel(c.cookie, id)).status).toBe(200);

    const res = await cancel(c.cookie, id, { reason: 'Again' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DOCUMENT_LOCKED');
    expect(await stockOf(pool, c.rice)).toBe(0);
    expect(await auditCount('purchase.cancel')).toBe(1);
  });

  it("answers 404 for another branch's purchase and for one that does not exist", async () => {
    const c = await counter();
    const other = await counter();
    const id = await posted(other, [line(other.rice, 5)]);

    expect((await cancel(c.cookie, id)).status).toBe(404);
    expect((await cancel(c.cookie, 999999)).status).toBe(404);
    expect((await storedPurchase(id)).status).toBe('posted');
    expect(await stockOf(pool, other.rice)).toBe(5);
  });
});

describe('prices', () => {
  it('keeps the prices the purchase set: cancelling does not revert them', async () => {
    const c = await counter();
    const id = await posted(c, [
      line(c.rice, 5, { newMrpPaise: 12000, newSellingPricePaise: 11000 }),
    ]);

    expect((await cancel(c.cookie, id)).status).toBe(200);

    const { rows } = await db.execute<{ mrp: string; selling: string }>(
      sql`select mrp_paise as mrp, selling_price_paise as selling from items where id = ${c.rice}`,
    );
    expect(rows.map((r) => [Number(r.mrp), Number(r.selling)])).toEqual([[12000, 11000]]);
  });
});

describe('re-entry', () => {
  it('lets the same vendor invoice be entered again as a new draft after the cancel', async () => {
    const c = await counter();
    const id = await posted(c, [line(c.rice, 5)]);
    expect((await cancel(c.cookie, id)).status).toBe(200);

    const res = await request(app)
      .post(URL)
      .set('Cookie', c.cookie)
      .send(draftBody(c, [line(c.rice, 4)]));

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'draft', vendorInvoiceNo: 'INV-2231' });
  });
});
