// Customer lookup (Task 5.4): GET /customers/lookup and findOrCreateByPhone, used by billing.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { expectAudit } from '../../../test/helpers/audit.js';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import { cookieFor, createBranch, createUser, mapUser } from '../../../test/helpers/fixtures.js';
import { createApp } from '../../app.js';
import { findOrCreateByPhone, type CustomerWriteBy } from './customers.service.js';

const { db, pool } = createTestDb();
const app = createApp({ db });
const URL = '/api/v1/customers/lookup';

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

/** A cashier working in a new branch. */
async function cashier(): Promise<{ userId: number; branchId: number; cookie: string }> {
  const branchId = await createBranch(pool);
  const userId = await createUser(pool, { role: 'cashier' });
  await mapUser(pool, userId, branchId);
  return { userId, branchId, cookie: await cookieFor(db, userId, branchId) };
}

async function addCustomer(phone: string, name: string | null = null): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    'insert into customers (phone, name) values ($1, $2) returning id',
    [phone, name],
  );
  return Number(rows[0]!.id);
}

async function storedCustomers() {
  const { rows } = await pool.query('select id, phone, name from customers order by id');
  return rows.map((row) => ({ id: Number(row.id), phone: row.phone, name: row.name }));
}

async function auditCount(action: string): Promise<number> {
  const { rows } = await pool.query('select 1 from audit_logs where action = $1', [action]);
  return rows.length;
}

function lookup(cookie: string, phone: string) {
  return request(app).get(URL).query({ phone }).set('Cookie', cookie);
}

describe('GET /customers/lookup', () => {
  it('finds the customer by phone, in any common format', async () => {
    const { cookie } = await cashier();
    const id = await addCustomer('9876543210', 'Kumar');

    for (const phone of ['9876543210', '+91 98765 43210', '09876543210']) {
      const res = await lookup(cookie, phone);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ id, phone: '9876543210', name: 'Kumar' });
    }
  });

  it('answers 404 for a phone with no customer', async () => {
    const { cookie } = await cashier();
    const res = await lookup(cookie, '9876543210');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('finds the same customer from another branch: customers are client-wide (D-08)', async () => {
    const tpr = await cashier();
    const cbe = await cashier();
    const id = await addCustomer('9876543210');

    expect((await lookup(tpr.cookie, '9876543210')).body.data.id).toBe(id);
    expect((await lookup(cbe.cookie, '9876543210')).body.data.id).toBe(id);
  });

  it.each(['12345', '5876543210', '98765432101', 'abc'])(
    'refuses %s with 422 on the phone',
    async (phone) => {
      const { cookie } = await cashier();
      const res = await lookup(cookie, phone);
      expect(res.status).toBe(422);
      expect(res.body.error.details[0].path).toBe('query.phone');
    },
  );

  it('refuses a missing phone with 422', async () => {
    const { cookie } = await cashier();
    const res = await request(app).get(URL).set('Cookie', cookie);
    expect(res.status).toBe(422);
  });

  it('never creates a customer', async () => {
    const { cookie } = await cashier();
    await lookup(cookie, '9876543210');
    expect(await storedCustomers()).toEqual([]);
  });

  it('answers 401 without a session, and 403 FORBIDDEN to the Admin (no bill:create)', async () => {
    expect((await request(app).get(URL).query({ phone: '9876543210' })).status).toBe(401);
    const admin = await cookieFor(db, await createUser(pool, { role: 'admin' }));
    const res = await lookup(admin, '9876543210');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('findOrCreateByPhone', () => {
  async function by(): Promise<CustomerWriteBy> {
    const { userId, branchId } = await cashier();
    return { actorId: userId, branchId, ip: '127.0.0.1' };
  }

  it('creates a customer once, then returns the same one', async () => {
    const writer = await by();

    const first = await db.transaction((tx) =>
      findOrCreateByPhone(tx, '+91 98765 43210', 'Kumar', writer),
    );
    const second = await db.transaction((tx) =>
      findOrCreateByPhone(tx, '09876543210', undefined, writer),
    );

    expect(first).toEqual({ id: expect.any(Number), phone: '9876543210', name: 'Kumar' });
    expect(second).toEqual(first);
    expect(await storedCustomers()).toHaveLength(1);
    const audit = await expectAudit(db, {
      action: 'customer.create',
      entity: 'customer',
      entityId: first.id,
      actorId: writer.actorId,
    });
    expect(audit.branchId).toBe(writer.branchId);
    expect(audit.after).toEqual({ phone: '9876543210', name: 'Kumar' });
    expect(await auditCount('customer.create')).toBe(1);
  });

  it('creates a customer without a name, treating a blank name as none', async () => {
    const writer = await by();
    const customer = await db.transaction((tx) =>
      findOrCreateByPhone(tx, '9876543210', '   ', writer),
    );
    expect(customer.name).toBeNull();
  });

  it('fills in the name of a known customer who had none, and audits it', async () => {
    const writer = await by();
    const id = await addCustomer('9876543210');

    const customer = await db.transaction((tx) =>
      findOrCreateByPhone(tx, '9876543210', ' Kumar ', writer),
    );

    expect(customer).toEqual({ id, phone: '9876543210', name: 'Kumar' });
    const audit = await expectAudit(db, { action: 'customer.update', entityId: id });
    expect(audit.before).toEqual({ name: null });
    expect(audit.after).toEqual({ name: 'Kumar' });
  });

  it('never overwrites a known name, and writes nothing then', async () => {
    const writer = await by();
    const id = await addCustomer('9876543210', 'Kumar');

    const customer = await db.transaction((tx) =>
      findOrCreateByPhone(tx, '9876543210', 'Someone Else', writer),
    );

    expect(customer).toEqual({ id, phone: '9876543210', name: 'Kumar' });
    expect(await auditCount('customer.update')).toBe(0);
    expect(await auditCount('customer.create')).toBe(0);
  });

  it('gives two counters creating the same phone at once the same customer', async () => {
    const writer = await by();
    const [a, b] = await Promise.all([
      db.transaction((tx) => findOrCreateByPhone(tx, '9876543210', 'Kumar', writer)),
      db.transaction((tx) => findOrCreateByPhone(tx, '+919876543210', undefined, writer)),
    ]);
    expect(a.id).toBe(b.id);
    expect(await storedCustomers()).toHaveLength(1);
    expect(await auditCount('customer.create')).toBe(1);
  });

  it('refuses a phone that is not a 10-digit mobile number with 422, creating nothing', async () => {
    const writer = await by();
    await expect(
      db.transaction((tx) => findOrCreateByPhone(tx, '12345', 'Kumar', writer)),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 422,
      details: [{ path: 'body.customer.phone' }],
    });
    expect(await storedCustomers()).toEqual([]);
  });

  it('creates nothing when the caller’s transaction rolls back (the bill failed)', async () => {
    const writer = await by();
    await expect(
      db.transaction(async (tx) => {
        await findOrCreateByPhone(tx, '9876543210', 'Kumar', writer);
        throw new Error('the bill failed');
      }),
    ).rejects.toThrow('the bill failed');
    expect(await storedCustomers()).toEqual([]);
    expect(await auditCount('customer.create')).toBe(0);
  });
});
