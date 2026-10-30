// Posting a purchase (Task 4.3): stock in through the ledger, new prices applied, purchase locked,
// all in one transaction.
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
import {
  assertLedgerMatchesStock,
  movementCount,
  seedOpeningStock,
  stockOf,
} from '../../../test/helpers/ledger.js';
import { createApp } from '../../app.js';

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

function line(itemId: number, quantity: number, costPricePaise: number, extra: Body = {}): Body {
  return { itemId, quantity, costPricePaise, ...extra };
}

/** Create a draft through the API and return its id. */
async function draft(c: Counter, lines: Body[], invoice = 'INV-2231'): Promise<number> {
  const res = await request(app)
    .post(URL)
    .set('Cookie', c.cookie)
    .send({ vendorId: c.vendorId, vendorInvoiceNo: invoice, invoiceDate: '2026-10-28', lines });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id as number;
}

function post(cookie: string, id: number) {
  return request(app).post(`${URL}/${id}/post`).set('Cookie', cookie);
}

async function statusOf(id: number): Promise<string> {
  const { rows } = await pool.query('select status from purchases where id = $1', [id]);
  return rows[0].status as string;
}

async function pricesOf(itemId: number) {
  const { rows } = await pool.query(
    'select mrp_paise, selling_price_paise from items where id = $1',
    [itemId],
  );
  return {
    mrpPaise: Number(rows[0].mrp_paise),
    sellingPricePaise: Number(rows[0].selling_price_paise),
  };
}

/** The ledger rows a purchase produced. */
async function movementsOf(purchaseId: number) {
  const { rows } = await pool.query(
    `select item_id, type, quantity, ref_type, created_by from stock_movements
      where ref_type = 'purchase' and ref_id = $1 order by id`,
    [purchaseId],
  );
  return rows.map((row) => ({
    itemId: Number(row.item_id),
    type: row.type as string,
    quantity: Number(row.quantity),
    refType: row.ref_type as string,
    createdBy: Number(row.created_by),
  }));
}

async function auditCount(action: string): Promise<number> {
  const { rows } = await pool.query('select 1 from audit_logs where action = $1', [action]);
  return rows.length;
}

describe('access control', () => {
  it('answers 401 without a session', async () => {
    expect((await request(app).post(`${URL}/1/post`)).status).toBe(401);
  });

  it('refuses an Admin with 403 FORBIDDEN, and posts nothing', async () => {
    const c = await counter();
    const id = await draft(c, [line(c.rice, 5, 100)]);
    const admin = await cookieFor(db, await createUser(pool, { role: 'admin' }));

    const res = await post(admin, id);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(await statusOf(id)).toBe('draft');
    expect(await stockOf(pool, c.rice)).toBe(0);
  });

  it('asks a cashier without a chosen branch to choose one (403 NO_ACTIVE_BRANCH)', async () => {
    const cookie = await cookieFor(db, await createUser(pool, { role: 'cashier' }), null);
    const res = await post(cookie, 1);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NO_ACTIVE_BRANCH');
  });
});

describe('POST /purchases/:id/post', () => {
  it('posts the draft: stock in with one purchase movement per line, locked, and audited', async () => {
    const c = await counter();
    await seedOpeningStock(pool, {
      branchId: c.branchId,
      itemId: c.rice,
      userId: c.userId,
      quantity: 10,
    });
    const id = await draft(c, [line(c.rice, 24, 45000), line(c.dal, 6, 11000)]);

    const res = await post(c.cookie, id);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id,
      status: 'posted',
      postedBy: { id: c.userId, fullName: 'Ravi Kumar' },
      totalPaise: 24 * 45000 + 6 * 11000,
    });
    expect(typeof res.body.data.postedAt).toBe('string');
    expect(await stockOf(pool, c.rice)).toBe(34);
    expect(await stockOf(pool, c.dal)).toBe(6);
    expect(await movementsOf(id)).toEqual([
      { itemId: c.rice, type: 'purchase', quantity: 24, refType: 'purchase', createdBy: c.userId },
      { itemId: c.dal, type: 'purchase', quantity: 6, refType: 'purchase', createdBy: c.userId },
    ]);
    await assertLedgerMatchesStock(pool, c.rice);
    await assertLedgerMatchesStock(pool, c.dal);

    const audit = await expectAudit(db, {
      action: 'purchase.post',
      entity: 'purchase',
      entityId: id,
      actorId: c.userId,
    });
    expect(audit.before).toEqual({ status: 'draft' });
    expect(audit.after).toEqual({ status: 'posted', totalPaise: 1146000, lineCount: 2 });
  });

  it('adds both lines when an item appears twice', async () => {
    const c = await counter();
    const id = await draft(c, [line(c.rice, 5, 100), line(c.rice, 2, 0)]);

    expect((await post(c.cookie, id)).status).toBe(200);
    expect(await stockOf(pool, c.rice)).toBe(7);
    expect(await movementCount(pool, c.rice)).toBe(2);
    await assertLedgerMatchesStock(pool, c.rice);
  });

  it('can no longer be edited once posted (DOCUMENT_LOCKED)', async () => {
    const c = await counter();
    const id = await draft(c, [line(c.rice, 5, 100)]);
    await post(c.cookie, id);

    const res = await request(app)
      .put(`${URL}/${id}`)
      .set('Cookie', c.cookie)
      .send({ vendorId: c.vendorId, vendorInvoiceNo: 'X', invoiceDate: '2026-10-28', lines: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DOCUMENT_LOCKED');
  });
});

describe('new prices', () => {
  it('applies a new MRP and selling price to the item, with an audit row per item changed', async () => {
    const c = await counter();
    const id = await draft(c, [
      line(c.rice, 1, 45000, { newMrpPaise: 12000, newSellingPricePaise: 11000 }),
      line(c.dal, 1, 100),
    ]);

    expect((await post(c.cookie, id)).status).toBe(200);

    expect(await pricesOf(c.rice)).toEqual({ mrpPaise: 12000, sellingPricePaise: 11000 });
    expect(await pricesOf(c.dal)).toEqual({ mrpPaise: 10000, sellingPricePaise: 9000 });
    const audit = await expectAudit(db, {
      action: 'item.update',
      entity: 'item',
      entityId: c.rice,
      actorId: c.userId,
    });
    expect(audit.before).toEqual({ mrpPaise: 10000, sellingPricePaise: 9000 });
    expect(audit.after).toEqual({ mrpPaise: 12000, sellingPricePaise: 11000, purchaseId: id });
    expect(await auditCount('item.update')).toBe(1);
  });

  it('changes only the price given, and records only that one', async () => {
    const c = await counter();
    const id = await draft(c, [line(c.rice, 1, 100, { newSellingPricePaise: 9500 })]);

    expect((await post(c.cookie, id)).status).toBe(200);
    expect(await pricesOf(c.rice)).toEqual({ mrpPaise: 10000, sellingPricePaise: 9500 });
    const audit = await expectAudit(db, { action: 'item.update', entityId: c.rice });
    expect(audit.after).toEqual({ sellingPricePaise: 9500, purchaseId: id });
  });

  it('writes no audit row for a "new" price equal to the current one', async () => {
    const c = await counter();
    const id = await draft(c, [line(c.rice, 1, 100, { newMrpPaise: 10000 })]);

    expect((await post(c.cookie, id)).status).toBe(200);
    expect(await auditCount('item.update')).toBe(0);
  });

  it('lets the later line win when two lines of one item give new prices', async () => {
    const c = await counter();
    const id = await draft(c, [
      line(c.rice, 1, 100, { newSellingPricePaise: 8000 }),
      line(c.rice, 1, 100, { newSellingPricePaise: 8500 }),
    ]);

    expect((await post(c.cookie, id)).status).toBe(200);
    expect((await pricesOf(c.rice)).sellingPricePaise).toBe(8500);
  });

  it.each([
    ['a new selling price above the current MRP', { newSellingPricePaise: 10001 }],
    ['a new MRP below the current selling price', { newMrpPaise: 8999 }],
    ['a new selling price above the new MRP', { newMrpPaise: 12000, newSellingPricePaise: 12001 }],
  ])('refuses %s with 422, and saves nothing', async (_label, prices) => {
    const c = await counter();
    const id = await draft(c, [line(c.dal, 3, 100), line(c.rice, 4, 100, prices)]);

    const res = await post(c.cookie, id);

    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([
      { path: 'lines.1.newSellingPricePaise', message: 'Selling price cannot be above the MRP' },
    ]);
    expect(await statusOf(id)).toBe('draft');
    expect(await pricesOf(c.rice)).toEqual({ mrpPaise: 10000, sellingPricePaise: 9000 });
    expect(await stockOf(pool, c.rice)).toBe(0);
    expect(await stockOf(pool, c.dal)).toBe(0);
    expect(await movementsOf(id)).toEqual([]);
    expect(await auditCount('purchase.post')).toBe(0);
  });
});

describe('refusals', () => {
  it('refuses a draft with no lines with 400 EMPTY_PURCHASE', async () => {
    const c = await counter();
    const id = await draft(c, []);

    const res = await post(c.cookie, id);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMPTY_PURCHASE');
    expect(await statusOf(id)).toBe('draft');
  });

  it('refuses to post again with 400 DOCUMENT_LOCKED, adding no more stock', async () => {
    const c = await counter();
    const id = await draft(c, [line(c.rice, 5, 100)]);
    expect((await post(c.cookie, id)).status).toBe(200);

    const res = await post(c.cookie, id);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DOCUMENT_LOCKED');
    expect(await stockOf(pool, c.rice)).toBe(5);
    expect(await auditCount('purchase.post')).toBe(1);
  });

  it('refuses to post a cancelled purchase with 400 DOCUMENT_LOCKED', async () => {
    const c = await counter();
    const id = await draft(c, [line(c.rice, 5, 100)]);
    await pool.query(`update purchases set status = 'cancelled' where id = $1`, [id]);

    const res = await post(c.cookie, id);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DOCUMENT_LOCKED');
    expect(await stockOf(pool, c.rice)).toBe(0);
  });

  it("answers 404 for another branch's purchase and for one that does not exist", async () => {
    const c = await counter();
    const other = await counter();
    const id = await draft(other, [line(other.rice, 5, 100)]);

    expect((await post(c.cookie, id)).status).toBe(404);
    expect((await post(c.cookie, 999999)).status).toBe(404);
    expect(await statusOf(id)).toBe('draft');
    expect(await stockOf(pool, other.rice)).toBe(0);
  });
});

describe('concurrency', () => {
  // "Done when": this passes 10 runs in a row; the loop is those runs
  it.each(Array.from({ length: 10 }, (_, run) => run + 1))(
    'lets exactly one of two parallel posts succeed, adding the stock once (run %i)',
    async () => {
      const c = await counter();
      const id = await draft(c, [line(c.rice, 24, 100), line(c.dal, 6, 100)]);

      const [first, second] = await Promise.all([post(c.cookie, id), post(c.cookie, id)]);

      expect([first.status, second.status].sort()).toEqual([200, 400]);
      const loser = first.status === 400 ? first : second;
      expect(loser.body.error.code).toBe('DOCUMENT_LOCKED');
      expect(await stockOf(pool, c.rice)).toBe(24);
      expect(await stockOf(pool, c.dal)).toBe(6);
      expect(await movementsOf(id)).toHaveLength(2);
      expect(await auditCount('purchase.post')).toBe(1);
      await assertLedgerMatchesStock(pool, c.rice);
      await assertLedgerMatchesStock(pool, c.dal);
    },
  );
});
