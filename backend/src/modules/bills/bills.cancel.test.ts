// Cancelling a bill (Task 5.6; D-14): stock back through the ledger, the number kept.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { expectAudit } from '../../../test/helpers/audit.js';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import {
  cookieFor,
  createBranch,
  createItem,
  createUser,
  mapUser,
} from '../../../test/helpers/fixtures.js';
import {
  assertLedgerMatchesStock,
  seedOpeningStock,
  stockOf,
} from '../../../test/helpers/ledger.js';
import { createApp } from '../../app.js';

const { db, pool } = createTestDb();
const app = createApp({ db });
const URL = '/api/v1/bills';

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
  rice: number;
  dal: number;
}

/** A cashier at a new branch with two ₹100 items, 10 packs each. */
async function counter(): Promise<Counter> {
  const branchId = await createBranch(pool);
  const userId = await createUser(pool, { role: 'cashier', fullName: 'Ravi Kumar' });
  await mapUser(pool, userId, branchId);
  const item = async (code: string) => {
    const id = await createItem(pool, branchId, {
      code,
      mrpPaise: 10000,
      sellingPricePaise: 10000,
    });
    await seedOpeningStock(pool, { branchId, itemId: id, userId, quantity: 10 });
    return id;
  };
  return {
    userId,
    branchId,
    cookie: await cookieFor(db, userId, branchId),
    rice: await item('R10'),
    dal: await item('D1'),
  };
}

/** Sell 2 rice and 3 dal (₹500, cash) and return the bill. */
async function sell(c: Counter) {
  const res = await request(app)
    .post(URL)
    .set('Cookie', c.cookie)
    .send({
      lines: [
        { itemId: c.rice, quantity: 2 },
        { itemId: c.dal, quantity: 3 },
      ],
      payments: [{ mode: 'cash', amountPaise: 50000 }],
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: number; billNo: string };
}

function cancel(cookie: string, id: number, body: object = { reason: 'Customer changed mind' }) {
  return request(app).post(`${URL}/${id}/cancel`).set('Cookie', cookie).send(body);
}

async function storedBill(id: number) {
  const { rows } = await pool.query(
    `select status, bill_no, cancelled_by, cancelled_at is not null as has_cancelled_at,
            cancel_reason from bills where id = $1`,
    [id],
  );
  return {
    status: rows[0].status as string,
    billNo: rows[0].bill_no as string,
    cancelledBy: rows[0].cancelled_by === null ? null : Number(rows[0].cancelled_by),
    hasCancelledAt: rows[0].has_cancelled_at as boolean,
    cancelReason: rows[0].cancel_reason as string | null,
  };
}

async function cancelMovements(billId: number) {
  const { rows } = await pool.query(
    `select item_id, quantity from stock_movements
      where type = 'sale_cancel' and ref_type = 'bill' and ref_id = $1 order by id`,
    [billId],
  );
  return rows.map((row) => [Number(row.item_id), Number(row.quantity)]);
}

async function auditCount(action: string): Promise<number> {
  const { rows } = await pool.query('select 1 from audit_logs where action = $1', [action]);
  return rows.length;
}

describe('POST /bills/:id/cancel', () => {
  it('cancels the bill: stock restored by one sale_cancel per line, number kept, audited', async () => {
    const c = await counter();
    const sold = await sell(c);
    expect([await stockOf(pool, c.rice), await stockOf(pool, c.dal)]).toEqual([8, 7]);

    const res = await cancel(c.cookie, sold.id, { reason: '  Customer changed mind ' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: sold.id,
      billNo: sold.billNo,
      status: 'cancelled',
      cancelledBy: { id: c.userId, fullName: 'Ravi Kumar' },
      cancelReason: 'Customer changed mind',
    });
    expect(await storedBill(sold.id)).toEqual({
      status: 'cancelled',
      billNo: sold.billNo,
      cancelledBy: c.userId,
      hasCancelledAt: true,
      cancelReason: 'Customer changed mind',
    });
    expect(await cancelMovements(sold.id)).toEqual([
      [c.rice, 2],
      [c.dal, 3],
    ]);
    expect([await stockOf(pool, c.rice), await stockOf(pool, c.dal)]).toEqual([10, 10]);
    await assertLedgerMatchesStock(pool, c.rice);
    await assertLedgerMatchesStock(pool, c.dal);

    const audit = await expectAudit(db, {
      action: 'bill.cancel',
      entity: 'bill',
      entityId: sold.id,
      actorId: c.userId,
    });
    expect(audit.before).toEqual({ status: 'completed' });
    expect(audit.after).toEqual({
      status: 'cancelled',
      reason: 'Customer changed mind',
      billNo: sold.billNo,
    });
  });

  it('keeps the numbering going: the next bill takes the next number, not the cancelled one', async () => {
    const c = await counter();
    const first = await sell(c);
    await cancel(c.cookie, first.id);
    const second = await sell(c);
    expect(second.billNo.endsWith('000002')).toBe(true);
  });

  it('refuses to cancel twice with 400 DOCUMENT_LOCKED, putting no more stock back', async () => {
    const c = await counter();
    const sold = await sell(c);
    expect((await cancel(c.cookie, sold.id)).status).toBe(200);

    const again = await cancel(c.cookie, sold.id, { reason: 'Again' });

    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('DOCUMENT_LOCKED');
    expect(await stockOf(pool, c.rice)).toBe(10);
    expect(await auditCount('bill.cancel')).toBe(1);
  });

  it.each([
    ['missing', {}],
    ['blank', { reason: '   ' }],
    ['shorter than 3 characters', { reason: 'no' }],
    ['longer than 200 characters', { reason: 'x'.repeat(201) }],
  ])('refuses a reason that is %s with 422, and changes nothing', async (_label, body) => {
    const c = await counter();
    const sold = await sell(c);

    const res = await cancel(c.cookie, sold.id, body);

    expect(res.status).toBe(422);
    expect(res.body.error.details[0].path).toBe('body.reason');
    expect((await storedBill(sold.id)).status).toBe('completed');
    expect(await stockOf(pool, c.rice)).toBe(8);
  });

  it("answers 404 for another branch's bill and for one that does not exist", async () => {
    const c = await counter();
    const other = await counter();
    const sold = await sell(other);

    expect((await cancel(c.cookie, sold.id)).status).toBe(404);
    expect((await cancel(c.cookie, 999999)).status).toBe(404);
    expect((await storedBill(sold.id)).status).toBe('completed');
    expect(await stockOf(pool, other.rice)).toBe(8);
  });

  it('answers 401 without a session, 403 to the Admin and to a cashier with no branch', async () => {
    const c = await counter();
    const sold = await sell(c);
    const admin = await cookieFor(db, await createUser(pool, { role: 'admin' }));
    const noBranch = await cookieFor(db, await createUser(pool, { role: 'cashier' }), null);

    expect((await request(app).post(`${URL}/${sold.id}/cancel`).send({})).status).toBe(401);
    const byAdmin = await cancel(admin, sold.id);
    const byNoBranch = await cancel(noBranch, sold.id);
    expect([byAdmin.status, byAdmin.body.error.code]).toEqual([403, 'FORBIDDEN']);
    expect([byNoBranch.status, byNoBranch.body.error.code]).toEqual([403, 'NO_ACTIVE_BRANCH']);
    expect((await storedBill(sold.id)).status).toBe('completed');
  });

  it('lets exactly one of two parallel cancels through, putting the stock back once', async () => {
    const c = await counter();
    const sold = await sell(c);

    const [a, b] = await Promise.all([cancel(c.cookie, sold.id), cancel(c.cookie, sold.id)]);

    expect([a.status, b.status].sort()).toEqual([200, 400]);
    expect(await stockOf(pool, c.rice)).toBe(10);
    expect(await cancelMovements(sold.id)).toHaveLength(2);
    await assertLedgerMatchesStock(pool, c.rice);
  });
});
