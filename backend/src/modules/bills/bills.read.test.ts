// Finding, viewing and printing bills, and the branch code lock (Task 5.6).
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { expectAudit } from '../../../test/helpers/audit.js';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import {
  cookieFor,
  createBranch,
  createClientSettings,
  createItem,
  createUser,
  mapUser,
} from '../../../test/helpers/fixtures.js';
import { seedOpeningStock } from '../../../test/helpers/ledger.js';
import { createApp } from '../../app.js';
import { istDateTime } from './bills.service.js';

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
}

/** A cashier at a branch (TPR unless given) with one ₹100 item, 100 packs. */
async function counter(branchId?: number, fullName = 'Ravi Kumar'): Promise<Counter> {
  const branch =
    branchId ??
    (await createBranch(pool, {
      code: 'TPR',
      name: 'Tiruppur',
      address: '12 Main Road, Tiruppur',
    }));
  const userId = await createUser(pool, { role: 'cashier', fullName });
  await mapUser(pool, userId, branch);
  let rice: number;
  const { rows } = await pool.query('select id from items where branch_id = $1', [branch]);
  if (rows.length > 0) {
    rice = Number(rows[0].id);
  } else {
    rice = await createItem(pool, branch, {
      code: 'R10',
      name: 'Rice 10 kg',
      mrpPaise: 10500,
      sellingPricePaise: 10000,
    });
    await seedOpeningStock(pool, { branchId: branch, itemId: rice, userId, quantity: 100 });
  }
  return { userId, branchId: branch, cookie: await cookieFor(db, userId, branch), rice };
}

/** Sell `quantity` rice (₹100 each, cash), optionally to a customer; returns the bill. */
async function sell(c: Counter, quantity = 1, phone?: string) {
  const res = await request(app)
    .post(URL)
    .set('Cookie', c.cookie)
    .send({
      lines: [{ itemId: c.rice, quantity }],
      payments: [{ mode: 'cash', amountPaise: quantity * 10000 }],
      ...(phone ? { customer: { phone, name: 'Kumar' } } : {}),
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: number; billNo: string; billDate: string; createdAt: string };
}

/** Move a bill to another business date, as if it had been saved that day. */
async function setBillDate(id: number, date: string): Promise<void> {
  await pool.query('update bills set bill_date = $2 where id = $1', [id, date]);
}

async function list(c: Counter, query = '') {
  const res = await request(app).get(`${URL}${query}`).set('Cookie', c.cookie);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as { items: { id: number }[]; total: number; limit: number; offset: number };
}

const ids = (page: { items: { id: number }[] }) => page.items.map((bill) => bill.id);

describe('GET /bills', () => {
  it("lists the branch's bills newest first, and never another branch's", async () => {
    const c = await counter();
    const other = await counter(await createBranch(pool, { code: 'CBE' }));
    const first = await sell(c);
    const second = await sell(c, 2, '9876543210');
    await sell(other);

    const page = await list(c);

    expect(page).toMatchObject({ total: 2, limit: 20, offset: 0 });
    expect(ids(page)).toEqual([second.id, first.id]);
    expect(page.items[0]).toEqual({
      id: second.id,
      billNo: second.billNo,
      billDate: second.billDate,
      status: 'completed',
      cashier: { id: c.userId, fullName: 'Ravi Kumar' },
      customer: { phone: '9876543210', name: 'Kumar' },
      totalPaise: 20000,
      createdAt: second.createdAt,
    });
    expect(page.items[1]).toMatchObject({ customer: null });
  });

  it('filters by business date range, both ends included', async () => {
    const c = await counter();
    const [a, b, d] = [await sell(c), await sell(c), await sell(c)];
    await setBillDate(a.id, '2026-10-01');
    await setBillDate(b.id, '2026-10-15');
    await setBillDate(d.id, '2026-10-31');

    expect(ids(await list(c, '?from=2026-10-15'))).toEqual([d.id, b.id]);
    expect(ids(await list(c, '?to=2026-10-15'))).toEqual([b.id, a.id]);
    expect(ids(await list(c, '?from=2026-10-15&to=2026-10-15'))).toEqual([b.id]);
  });

  it('finds a bill by any part of its number, ignoring case', async () => {
    const c = await counter();
    const first = await sell(c);
    const second = await sell(c);
    expect(ids(await list(c, '?billNo=000002'))).toEqual([second.id]);
    expect(ids(await list(c, `?billNo=${encodeURIComponent(first.billNo.toLowerCase())}`))).toEqual(
      [first.id],
    );
  });

  it("finds bills by the customer's phone, in any common format", async () => {
    const c = await counter();
    await sell(c);
    const kumar = await sell(c, 1, '9876543210');
    expect(ids(await list(c, `?phone=${encodeURIComponent('+91 98765 43210')}`))).toEqual([
      kumar.id,
    ]);
    expect((await list(c, '?phone=9123456789')).items).toEqual([]);
  });

  it('filters by cashier and by status', async () => {
    const ravi = await counter();
    const priya = await counter(ravi.branchId, 'Priya');
    const byRavi = await sell(ravi);
    const byPriya = await sell(priya);
    await request(app)
      .post(`${URL}/${byRavi.id}/cancel`)
      .set('Cookie', ravi.cookie)
      .send({ reason: 'Wrong item' });

    expect(ids(await list(ravi, `?cashierId=${priya.userId}`))).toEqual([byPriya.id]);
    expect(ids(await list(ravi, '?status=cancelled'))).toEqual([byRavi.id]);
    expect(ids(await list(ravi, '?status=completed'))).toEqual([byPriya.id]);
  });

  it('pages with limit and offset, keeping the total', async () => {
    const c = await counter();
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await sell(c));
    const page = await list(c, '?limit=2&offset=2');
    expect(page).toMatchObject({ total: 5, limit: 2, offset: 2 });
    expect(ids(page)).toEqual([made[2]!.id, made[1]!.id]);
  });

  it.each([
    ['an end date before the start', '?from=2026-10-31&to=2026-10-01', 'query.to'],
    ['a bad phone', '?phone=12345', 'query.phone'],
    ['an unknown status', '?status=void', 'query.status'],
  ])('refuses %s with 422', async (_label, query, path) => {
    const c = await counter();
    const res = await request(app).get(`${URL}${query}`).set('Cookie', c.cookie);
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].path).toBe(path);
  });
});

describe('GET /bills/:id', () => {
  it('shows the bill with its lines and payments', async () => {
    const c = await counter();
    const sold = await sell(c, 3, '9876543210');

    const res = await request(app).get(`${URL}/${sold.id}`).set('Cookie', c.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: sold.id,
      billNo: sold.billNo,
      status: 'completed',
      totalPaise: 30000,
      customer: { phone: '9876543210', name: 'Kumar' },
      lines: [
        {
          lineNo: 1,
          itemId: c.rice,
          itemName: 'Rice 10 kg',
          itemCode: 'R10',
          mrpPaise: 10500,
          unitPricePaise: 10000,
          quantity: 3,
          discountPaise: 0,
          lineTotalPaise: 30000,
        },
      ],
      payments: [{ mode: 'cash', amountPaise: 30000 }],
    });
  });

  it("answers 404 for another branch's bill and for one that does not exist", async () => {
    const c = await counter();
    const other = await counter(await createBranch(pool, { code: 'CBE' }));
    const theirs = await sell(other);
    expect((await request(app).get(`${URL}/${theirs.id}`).set('Cookie', c.cookie)).status).toBe(
      404,
    );
    expect((await request(app).get(`${URL}/999999`).set('Cookie', c.cookie)).status).toBe(404);
  });
});

describe('GET /bills/:id/receipt', () => {
  it('gives everything the receipt prints', async () => {
    await createClientSettings(pool, {
      businessName: 'Demo Stores',
      address: 'Avinashi Road',
      phone: '0421 222222',
    });
    const c = await counter();
    await pool.query(`update branches set phone = '0421 111111', bill_footer = $2 where id = $1`, [
      c.branchId,
      'Thank you! Visit again.',
    ]);
    const sold = await sell(c, 2, '9876543210');

    const res = await request(app).get(`${URL}/${sold.id}/receipt`).set('Cookie', c.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      business: {
        name: 'Demo Stores',
        address: 'Avinashi Road',
        phone: '0421 222222',
        gstin: null,
      },
      branch: {
        code: 'TPR',
        name: 'Tiruppur',
        address: '12 Main Road, Tiruppur',
        phone: '0421 111111',
        footer: 'Thank you! Visit again.',
      },
      billNo: sold.billNo,
      billDate: sold.billDate,
      issuedAtIst: istDateTime(new Date(sold.createdAt)),
      cashierName: 'Ravi Kumar',
      customer: { phone: '9876543210', name: 'Kumar' },
      lines: [
        expect.objectContaining({ itemName: 'Rice 10 kg', quantity: 2, lineTotalPaise: 20000 }),
      ],
      subtotalPaise: 20000,
      discountPaise: 0,
      roundOffPaise: 0,
      totalPaise: 20000,
      payments: [{ mode: 'cash', amountPaise: 20000 }],
      status: 'completed',
      cancelReason: null,
    });
  });

  it('says when the bill is cancelled, and why', async () => {
    await createClientSettings(pool);
    const c = await counter();
    const sold = await sell(c);
    await request(app)
      .post(`${URL}/${sold.id}/cancel`)
      .set('Cookie', c.cookie)
      .send({ reason: 'Wrong item' });

    const res = await request(app).get(`${URL}/${sold.id}/receipt`).set('Cookie', c.cookie);
    expect(res.body.data).toMatchObject({ status: 'cancelled', cancelReason: 'Wrong item' });
  });

  it('answers 404 NOT_SET_UP before the business is set up', async () => {
    const c = await counter();
    const sold = await sell(c);
    const res = await request(app).get(`${URL}/${sold.id}/receipt`).set('Cookie', c.cookie);
    expect([res.status, res.body.error.code]).toEqual([404, 'NOT_SET_UP']);
  });
});

describe('istDateTime', () => {
  it('writes the IST wall clock: 18:35 UTC is 00:05 the next day in India', () => {
    expect(istDateTime(new Date('2026-10-30T08:35:00Z'))).toBe('30-10-2026 14:05');
    expect(istDateTime(new Date('2026-10-30T18:35:00Z'))).toBe('31-10-2026 00:05');
  });
});

describe('read permissions', () => {
  it('answers 401 without a session, and 403 to the Admin and to a cashier with no branch', async () => {
    const c = await counter();
    const sold = await sell(c);
    const admin = await cookieFor(db, await createUser(pool, { role: 'admin' }));
    const noBranch = await cookieFor(db, await createUser(pool, { role: 'cashier' }), null);

    for (const path of [URL, `${URL}/${sold.id}`, `${URL}/${sold.id}/receipt`]) {
      expect((await request(app).get(path)).status).toBe(401);
      const byAdmin = await request(app).get(path).set('Cookie', admin);
      const byNoBranch = await request(app).get(path).set('Cookie', noBranch);
      expect([byAdmin.status, byAdmin.body.error.code]).toEqual([403, 'FORBIDDEN']);
      expect([byNoBranch.status, byNoBranch.body.error.code]).toEqual([403, 'NO_ACTIVE_BRANCH']);
    }
  });
});

describe('branch code lock', () => {
  async function admin() {
    const adminId = await createUser(pool, { role: 'admin' });
    return { adminId, cookie: await cookieFor(db, adminId) };
  }

  function editBranch(cookie: string, id: number, body: object) {
    return request(app).patch(`/api/v1/admin/branches/${id}`).set('Cookie', cookie).send(body);
  }

  it('refuses a new code once the branch has a bill, with 400 CODE_LOCKED', async () => {
    const c = await counter();
    await sell(c);
    const { cookie } = await admin();

    const res = await editBranch(cookie, c.branchId, { code: 'TUP' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CODE_LOCKED');
    const { rows } = await pool.query('select code from branches where id = $1', [c.branchId]);
    expect(rows[0].code).toBe('TPR');
  });

  it('stays locked when the only bill is cancelled: the number still names the code', async () => {
    const c = await counter();
    const sold = await sell(c);
    await request(app)
      .post(`${URL}/${sold.id}/cancel`)
      .set('Cookie', c.cookie)
      .send({ reason: 'Wrong item' });
    const { cookie } = await admin();
    expect((await editBranch(cookie, c.branchId, { code: 'TUP' })).body.error.code).toBe(
      'CODE_LOCKED',
    );
  });

  it('still allows other edits, and the same code, once the branch has bills', async () => {
    const c = await counter();
    await sell(c);
    const { adminId, cookie } = await admin();

    const res = await editBranch(cookie, c.branchId, { code: 'tpr', name: 'Tiruppur Main' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ code: 'TPR', name: 'Tiruppur Main' });
    await expectAudit(db, { action: 'branch.update', entityId: c.branchId, actorId: adminId });
  });

  it('allows a new code while the branch has no bills', async () => {
    const branchId = await createBranch(pool, { code: 'TPR' });
    const { cookie } = await admin();
    const res = await editBranch(cookie, branchId, { code: 'TUP' });
    expect(res.status).toBe(200);
    expect(res.body.data.code).toBe('TUP');
  });
});
