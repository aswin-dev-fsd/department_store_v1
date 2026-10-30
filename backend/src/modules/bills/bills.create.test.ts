// Creating a bill (Task 5.5): one transaction for the number, the money and the stock.
import { schema } from '@ds/database';
import { BILL_STATUSES, computeBill, financialYear, PAYMENT_MODES } from '@ds/shared';
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
import type { RequestContext } from '../../middleware/auth.js';
import { createBill } from './bills.service.js';

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
  oil: number;
  soap: number;
}

/**
 * A cashier at branch TPR with the overview §6.4 items: Rice ₹650, Oil ₹145.50, Soap ₹38.25, each
 * with `stock` packs on the shelf.
 */
async function counter(code = 'TPR', stock = 100): Promise<Counter> {
  const branchId = await createBranch(pool, { code });
  const userId = await createUser(pool, { role: 'cashier', fullName: 'Ravi Kumar' });
  await mapUser(pool, userId, branchId);
  const item = async (itemCode: string, name: string, mrp: number, price: number) => {
    const id = await createItem(pool, branchId, {
      code: itemCode,
      name,
      mrpPaise: mrp,
      sellingPricePaise: price,
    });
    if (stock > 0) await seedOpeningStock(pool, { branchId, itemId: id, userId, quantity: stock });
    return id;
  };
  return {
    userId,
    branchId,
    cookie: await cookieFor(db, userId, branchId),
    rice: await item('R10', 'Rice 10 kg', 68000, 65000),
    oil: await item('O1', 'Sunflower Oil 1 L', 15000, 14550),
    soap: await item('S100', 'Bath Soap 100 g', 4000, 3825),
  };
}

/** The overview §6.4 worked example: total ₹1,036, paid ₹500 cash + ₹536 UPI. */
function workedExample(c: Counter) {
  return {
    lines: [
      { itemId: c.rice, quantity: 1, discountPaise: 2000 },
      { itemId: c.oil, quantity: 2, discountPaise: 0 },
      { itemId: c.soap, quantity: 3, discountPaise: 0 },
    ],
    payments: [
      { mode: 'cash', amountPaise: 50000 },
      { mode: 'upi', amountPaise: 53600 },
    ],
  };
}

function bill(c: Counter, body: unknown) {
  return request(app).post(URL).set('Cookie', c.cookie).send(body as object);
}

/** One line of `quantity` packs of an item, paid exactly in cash (₹38.25 soap: rounding applies). */
function simpleBill(itemId: number, quantity: number, unitPricePaise: number) {
  const { totalPaise } = computeBill([{ unitPricePaise, quantity, discountPaise: 0 }]);
  return {
    lines: [{ itemId, quantity, discountPaise: 0 }],
    payments: [{ mode: 'cash', amountPaise: totalPaise }],
  };
}

async function billCount(): Promise<number> {
  const { rows } = await pool.query('select count(*)::int as n from bills');
  return rows[0].n as number;
}

/** Rows a failed bill must not leave behind. */
async function nothingSaved(): Promise<void> {
  const { rows } = await pool.query(
    `select (select count(*) from bills)::int as bills,
            (select count(*) from bill_lines)::int as lines,
            (select count(*) from bill_payments)::int as payments,
            (select count(*) from bill_sequences)::int as sequences,
            (select count(*) from stock_movements where type = 'sale')::int as sales`,
  );
  expect(rows[0]).toEqual({ bills: 0, lines: 0, payments: 0, sequences: 0, sales: 0 });
}

async function ledgerOk(c: Counter): Promise<void> {
  for (const item of [c.rice, c.oil, c.soap]) await assertLedgerMatchesStock(pool, item);
}

const fy = () => financialYear(new Date());

describe('vocabularies', () => {
  it('match the database enums', () => {
    expect([...PAYMENT_MODES]).toEqual(schema.paymentMode.enumValues);
    expect([...BILL_STATUSES]).toEqual(schema.billStatus.enumValues);
  });
});

describe('POST /bills: the happy path', () => {
  it('saves the worked example: number, dates, snapshots, totals, payments, stock and audit', async () => {
    const c = await counter();

    const res = await bill(c, workedExample(c));

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const saved = res.body.data;
    expect(saved).toMatchObject({
      billNo: `TPR/${fy()}/000001`,
      fy: fy(),
      seq: 1,
      status: 'completed',
      cashier: { id: c.userId, fullName: 'Ravi Kumar' },
      customer: null,
      subtotalPaise: 105575,
      discountPaise: 2000,
      roundOffPaise: 25,
      totalPaise: 103600,
      payments: [
        { mode: 'cash', amountPaise: 50000 },
        { mode: 'upi', amountPaise: 53600 },
      ],
      cancelledBy: null,
      cancelReason: null,
    });
    expect(saved.lines).toEqual([
      {
        lineNo: 1,
        itemId: c.rice,
        itemName: 'Rice 10 kg',
        itemCode: 'R10',
        mrpPaise: 68000,
        unitPricePaise: 65000,
        quantity: 1,
        discountPaise: 2000,
        lineTotalPaise: 63000,
      },
      expect.objectContaining({ lineNo: 2, itemCode: 'O1', quantity: 2, lineTotalPaise: 29100 }),
      expect.objectContaining({ lineNo: 3, itemCode: 'S100', quantity: 3, lineTotalPaise: 11475 }),
    ]);

    // The IST business date of the moment it was saved
    const { rows } = await pool.query(
      `select bill_date::text as bill_date,
              to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as ist_date,
              customer_id from bills`,
    );
    expect(rows[0].bill_date).toBe(rows[0].ist_date);
    expect(saved.billDate).toBe(rows[0].bill_date);

    const { rows: moves } = await pool.query(
      `select item_id, type, quantity, ref_type, ref_id from stock_movements
        where type = 'sale' order by id`,
    );
    expect(moves.map((m) => [Number(m.item_id), m.type, Number(m.quantity), m.ref_type])).toEqual([
      [c.rice, 'sale', -1, 'bill'],
      [c.oil, 'sale', -2, 'bill'],
      [c.soap, 'sale', -3, 'bill'],
    ]);
    expect(moves.every((m) => Number(m.ref_id) === saved.id)).toBe(true);
    expect([await stockOf(pool, c.rice), await stockOf(pool, c.oil), await stockOf(pool, c.soap)])
      .toEqual([99, 98, 97]);
    await ledgerOk(c);

    const audit = await expectAudit(db, {
      action: 'bill.create',
      entity: 'bill',
      entityId: saved.id,
      actorId: c.userId,
    });
    expect(audit.branchId).toBe(c.branchId);
    expect(audit.after).toMatchObject({ billNo: `TPR/${fy()}/000001`, totalPaise: 103600 });
  });

  it('numbers the bills of a branch 1, 2, 3, and another branch from 1 again', async () => {
    const tpr = await counter('TPR');
    const cbe = await counter('CBE');
    const body = (c: Counter) => simpleBill(c.rice, 1, 65000);

    const numbers = [];
    for (let i = 0; i < 3; i++) numbers.push((await bill(tpr, body(tpr))).body.data.billNo);
    const cbeFirst = (await bill(cbe, body(cbe))).body.data.billNo;

    expect(numbers).toEqual([1, 2, 3].map((n) => `TPR/${fy()}/00000${n}`));
    expect(cbeFirst).toBe(`CBE/${fy()}/000001`);
  });

  it('keeps the price and name it sold at, whatever happens to the item later', async () => {
    const c = await counter();
    const id = (await bill(c, simpleBill(c.rice, 1, 65000))).body.data.id as number;
    await pool.query(`update items set name = 'Renamed', selling_price_paise = 1 where id = $1`, [
      c.rice,
    ]);
    const { rows } = await pool.query(
      'select item_name, unit_price_paise::int as price from bill_lines where bill_id = $1',
      [id],
    );
    expect(rows).toEqual([{ item_name: 'Rice 10 kg', price: 65000 }]);
  });
});

describe('the financial year', () => {
  it('starts a new sequence at 1 April IST: 23:59 on 31 March and 00:01 on 1 April differ', async () => {
    const c = await counter();
    const ctx = {
      user: { id: c.userId, username: 'u', fullName: 'Ravi Kumar', role: 'cashier', mustChangePassword: false },
      activeBranchId: c.branchId,
      sessionId: 0,
      sessionToken: '',
    } as unknown as RequestContext;
    const body = { ...simpleBill(c.rice, 1, 65000) } as never;

    const march = await createBill(db, ctx, c.branchId, body, new Date('2027-03-31T18:29:00Z'), null);
    const april = await createBill(db, ctx, c.branchId, body, new Date('2027-03-31T18:31:00Z'), null);
    const april2 = await createBill(db, ctx, c.branchId, body, new Date('2027-04-01T06:00:00Z'), null);

    expect([march.billNo, march.billDate]).toEqual(['TPR/26-27/000001', '2027-03-31']);
    expect([april.billNo, april.billDate]).toEqual(['TPR/27-28/000001', '2027-04-01']);
    expect(april2.billNo).toBe('TPR/27-28/000002');
  });
});

describe('insufficient stock', () => {
  it('refuses with 400 INSUFFICIENT_STOCK naming the item, saves nothing, and wastes no number', async () => {
    const c = await counter('TPR', 2);

    const res = await bill(c, simpleBill(c.rice, 3, 65000));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.details).toEqual([
      { itemId: c.rice, name: 'Rice 10 kg', available: 2, requested: 3 },
    ]);
    await nothingSaved();
    expect(await stockOf(pool, c.rice)).toBe(2);

    const next = await bill(c, simpleBill(c.rice, 2, 65000));
    expect(next.status).toBe(201);
    expect(next.body.data.billNo).toBe(`TPR/${fy()}/000001`);
    await ledgerOk(c);
  });

  it('checks two lines of the same item against their combined quantity', async () => {
    const c = await counter('TPR', 5);
    const twoLines = {
      lines: [
        { itemId: c.rice, quantity: 3, discountPaise: 0 },
        { itemId: c.rice, quantity: 3, discountPaise: 0 },
      ],
      payments: [{ mode: 'cash', amountPaise: 390000 }],
    };

    const refused = await bill(c, twoLines);
    expect(refused.status).toBe(400);
    expect(refused.body.error.details).toEqual([
      { itemId: c.rice, name: 'Rice 10 kg', available: 5, requested: 6 },
    ]);
    await nothingSaved();
    await ledgerOk(c);
  });
});

describe('same item twice', () => {
  it('saves both lines, and takes out their combined quantity', async () => {
    const c = await counter('TPR', 10);
    const res = await bill(c, {
      lines: [
        { itemId: c.rice, quantity: 2, discountPaise: 0 },
        { itemId: c.rice, quantity: 3, discountPaise: 1000 },
      ],
      payments: [{ mode: 'card', amountPaise: 324000 }],
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.lines.map((l: { quantity: number }) => l.quantity)).toEqual([2, 3]);
    expect(res.body.data.totalPaise).toBe(324000);
    expect(await stockOf(pool, c.rice)).toBe(5);
    await ledgerOk(c);
  });
});

describe('payments', () => {
  it.each([
    ['short', 103500],
    ['over (the change is not recorded)', 103700],
  ])('refuses payments that are %s with 400 PAYMENT_MISMATCH, saving nothing', async (_label, paid) => {
    const c = await counter();
    const res = await bill(c, {
      ...workedExample(c),
      payments: [{ mode: 'cash', amountPaise: paid }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PAYMENT_MISMATCH');
    expect(res.body.error.details).toEqual({ totalPaise: 103600, paidPaise: paid });
    await nothingSaved();
    expect(await stockOf(pool, c.rice)).toBe(100);
  });

  it('accepts a split across all three modes that adds up exactly', async () => {
    const c = await counter();
    const res = await bill(c, {
      ...workedExample(c),
      payments: [
        { mode: 'cash', amountPaise: 3600 },
        { mode: 'upi', amountPaise: 50000 },
        { mode: 'card', amountPaise: 50000 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.payments).toHaveLength(3);
  });

  it('refuses the same mode twice, and a payment of 0 (422)', async () => {
    const c = await counter();
    const twice = await bill(c, {
      ...workedExample(c),
      payments: [
        { mode: 'cash', amountPaise: 50000 },
        { mode: 'cash', amountPaise: 53600 },
      ],
    });
    const zero = await bill(c, {
      ...workedExample(c),
      payments: [
        { mode: 'cash', amountPaise: 103600 },
        { mode: 'upi', amountPaise: 0 },
      ],
    });
    expect([twice.status, zero.status]).toEqual([422, 422]);
    await nothingSaved();
  });
});

describe('no price tampering', () => {
  it.each([
    ['a unit price on a line', { lines: [{ itemId: 0, quantity: 1, unitPricePaise: 1 }] }],
    ['a total on the bill', { totalPaise: 1 }],
    ['a line total', { lines: [{ itemId: 0, quantity: 1, lineTotalPaise: 1 }] }],
  ])('refuses %s with 422, saving nothing', async (_label, extra) => {
    const c = await counter();
    const base = simpleBill(c.rice, 1, 65000);
    const body = {
      ...base,
      ...extra,
      lines:
        'lines' in extra
          ? extra.lines.map((line) => ({ ...line, itemId: c.rice }))
          : base.lines,
    };
    const res = await bill(c, body);
    expect(res.status).toBe(422);
    await nothingSaved();
  });
});

describe('bad requests', () => {
  it("refuses an inactive item, another branch's and an unknown one with 404, saving nothing", async () => {
    const c = await counter();
    const other = await counter('CBE');
    const inactive = await createItem(pool, c.branchId, { isActive: false });

    for (const itemId of [inactive, other.rice, 999999]) {
      const res = await bill(c, {
        lines: [
          { itemId: c.soap, quantity: 1, discountPaise: 0 },
          { itemId, quantity: 1, discountPaise: 0 },
        ],
        payments: [{ mode: 'cash', amountPaise: 100000 }],
      });
      expect(res.status).toBe(404);
    }
    await nothingSaved();
    expect(await stockOf(pool, other.rice)).toBe(100);
  });

  it('refuses a discount above its line amount with 422 on that discount', async () => {
    const c = await counter();
    const res = await bill(c, {
      lines: [
        { itemId: c.soap, quantity: 1, discountPaise: 0 },
        { itemId: c.oil, quantity: 1, discountPaise: 14551 },
      ],
      payments: [{ mode: 'cash', amountPaise: 3800 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].path).toBe('body.lines.1.discountPaise');
    await nothingSaved();
  });

  it.each([
    ['no lines', { lines: [] }],
    ['no payments', { payments: [] }],
    ['a quantity of 0', { lines: [{ itemId: 1, quantity: 0 }] }],
    ['a negative discount', { lines: [{ itemId: 1, quantity: 1, discountPaise: -1 }] }],
    ['an unknown payment mode', { payments: [{ mode: 'cheque', amountPaise: 100 }] }],
  ])('refuses %s with 422', async (_label, overrides) => {
    const c = await counter();
    const res = await bill(c, { ...simpleBill(c.rice, 1, 65000), ...overrides });
    expect(res.status).toBe(422);
    await nothingSaved();
  });
});

describe('customer', () => {
  it('creates and links a customer from a phone, then links the same one next time', async () => {
    const c = await counter();
    const first = await bill(c, {
      ...simpleBill(c.rice, 1, 65000),
      customer: { phone: '+91 98765 43210', name: 'Kumar' },
    });
    const second = await bill(c, {
      ...simpleBill(c.rice, 1, 65000),
      customer: { phone: '9876543210' },
    });

    expect(first.status).toBe(201);
    expect(first.body.data.customer).toEqual({
      id: expect.any(Number),
      phone: '9876543210',
      name: 'Kumar',
    });
    expect(second.body.data.customer).toEqual(first.body.data.customer);
    const { rows } = await pool.query('select count(*)::int as n from customers');
    expect(rows[0].n).toBe(1);
  });

  it('leaves customer_id empty when no customer is given', async () => {
    const c = await counter();
    const res = await bill(c, simpleBill(c.rice, 1, 65000));
    const { rows } = await pool.query('select customer_id from bills where id = $1', [
      res.body.data.id,
    ]);
    expect(rows[0].customer_id).toBeNull();
  });

  it('refuses a bad phone with 422, and creates no customer when the bill fails', async () => {
    const c = await counter('TPR', 0);
    const badPhone = await bill(c, {
      ...simpleBill(c.rice, 1, 65000),
      customer: { phone: '12345' },
    });
    expect(badPhone.status).toBe(422);

    const noStock = await bill(c, {
      ...simpleBill(c.rice, 1, 65000),
      customer: { phone: '9876543210', name: 'Kumar' },
    });
    expect(noStock.body.error.code).toBe('INSUFFICIENT_STOCK');
    const { rows } = await pool.query('select count(*)::int as n from customers');
    expect(rows[0].n).toBe(0);
  });
});

describe('permissions', () => {
  it('answers 401 without a session', async () => {
    expect((await request(app).post(URL).send({})).status).toBe(401);
  });

  it('refuses the Admin with 403 FORBIDDEN, and a cashier with no branch with 403 NO_ACTIVE_BRANCH', async () => {
    const c = await counter();
    const admin = await cookieFor(db, await createUser(pool, { role: 'admin' }));
    const noBranch = await cookieFor(db, await createUser(pool, { role: 'cashier' }), null);

    const byAdmin = await request(app).post(URL).set('Cookie', admin).send(workedExample(c));
    const byNoBranch = await request(app).post(URL).set('Cookie', noBranch).send(workedExample(c));

    expect([byAdmin.status, byAdmin.body.error.code]).toEqual([403, 'FORBIDDEN']);
    expect([byNoBranch.status, byNoBranch.body.error.code]).toEqual([403, 'NO_ACTIVE_BRANCH']);
    await nothingSaved();
  });
});

describe('concurrency', () => {
  // "Done when": these pass 10 runs in a row; the loops are those runs
  const runs = Array.from({ length: 10 }, (_, run) => run + 1);

  it.each(runs)('sells the last unit once: one 201, one INSUFFICIENT_STOCK (run %i)', async () => {
    const c = await counter('TPR', 1);
    const body = simpleBill(c.rice, 1, 65000);

    const [a, b] = await Promise.all([bill(c, body), bill(c, body)]);

    expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect((a.status === 400 ? a : b).body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await stockOf(pool, c.rice)).toBe(0);
    expect(await billCount()).toBe(1);
    expect((a.status === 201 ? a : b).body.data.billNo).toBe(`TPR/${fy()}/000001`);
    await ledgerOk(c);
  });

  it.each(runs)('numbers 50 parallel bills 000001–000050 with no gaps (run %i)', async () => {
    const c = await counter('TPR', 50);
    const body = simpleBill(c.soap, 1, 3825);

    const responses = await Promise.all(Array.from({ length: 50 }, () => bill(c, body)));

    expect(responses.map((r) => r.status)).toEqual(Array(50).fill(201));
    const numbers = responses.map((r) => r.body.data.billNo as string).sort();
    expect(numbers).toEqual(
      Array.from({ length: 50 }, (_, i) => `TPR/${fy()}/${String(i + 1).padStart(6, '0')}`),
    );
    expect(await stockOf(pool, c.soap)).toBe(0);
    await ledgerOk(c);
  });
});
