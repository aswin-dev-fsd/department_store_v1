import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { expectAudit } from '../../../test/helpers/audit.js';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import {
  cookieFor,
  createBranch,
  createUser,
  createVendor,
  mapUser,
} from '../../../test/helpers/fixtures.js';
import { createApp } from '../../app.js';

const { db, pool } = createTestDb();
const app = createApp({ db });
const URL = '/api/v1/vendors';
const GSTIN = '33ABCDE1234F1Z5';

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

interface Cashier {
  userId: number;
  branchId: number;
  cookie: string;
}

/** A cashier working in a branch (a new one unless given). */
async function cashierIn(branchId?: number): Promise<Cashier> {
  const branch = branchId ?? (await createBranch(pool));
  const userId = await createUser(pool, { role: 'cashier' });
  await mapUser(pool, userId, branch);
  return { userId, branchId: branch, cookie: await cookieFor(db, userId, branch) };
}

async function adminCookie(): Promise<string> {
  return cookieFor(db, await createUser(pool, { role: 'admin' }));
}

/** The body of a valid POST /vendors; override what a test is about. */
function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'Sri Traders', ...overrides };
}

interface Stored {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  gstin: string | null;
  isActive: boolean;
}

/** The branch's vendors straight from the database. */
async function stored(branchId: number): Promise<Stored[]> {
  const { rows } = await pool.query(
    `select id, name, phone, address, gstin, is_active
       from vendors where branch_id = $1 order by id`,
    [branchId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    phone: row.phone,
    address: row.address,
    gstin: row.gstin,
    isActive: row.is_active,
  }));
}

async function namesOf(branchId: number): Promise<string[]> {
  return (await stored(branchId)).map((vendor) => vendor.name);
}

async function auditCount(action: string): Promise<number> {
  const { rows } = await pool.query('select 1 from audit_logs where action = $1', [action]);
  return rows.length;
}

describe('access control', () => {
  it.each([
    ['GET', URL],
    ['POST', URL],
    ['PATCH', `${URL}/1`],
  ] as const)('%s %s answers 401 without a session', async (method, path) => {
    const agent = request(app);
    const res =
      method === 'GET'
        ? await agent.get(path)
        : method === 'POST'
          ? await agent.post(path)
          : await agent.patch(path);
    expect(res.status).toBe(401);
  });

  it('refuses an Admin on every route with 403 FORBIDDEN, and changes nothing', async () => {
    const branchId = await createBranch(pool);
    const id = await createVendor(pool, branchId, { name: 'Sri Traders' });
    const cookie = await adminCookie();

    const listed = await request(app).get(URL).set('Cookie', cookie);
    const created = await request(app).post(URL).set('Cookie', cookie).send(body());
    const edited = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ name: 'Hacked', isActive: false });

    for (const res of [listed, created, edited]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(await stored(branchId)).toMatchObject([{ name: 'Sri Traders', isActive: true }]);
  });

  it('asks a cashier without a chosen branch to choose one (403 NO_ACTIVE_BRANCH) on every route', async () => {
    const userId = await createUser(pool, { role: 'cashier' });
    const cookie = await cookieFor(db, userId, null);

    const responses = [
      await request(app).get(URL).set('Cookie', cookie),
      await request(app).post(URL).set('Cookie', cookie).send(body()),
      await request(app).patch(`${URL}/1`).set('Cookie', cookie).send({ name: 'x' }),
    ];

    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('NO_ACTIVE_BRANCH');
    }
  });
});

describe('POST /vendors', () => {
  it('creates a vendor in the active branch from just a name, and audits it', async () => {
    const { userId, branchId, cookie } = await cashierIn();

    const res = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send(body({ name: '  Sri Traders ' }));

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      id: expect.any(Number),
      name: 'Sri Traders',
      phone: null,
      address: null,
      gstin: null,
      isActive: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(await stored(branchId)).toEqual([
      {
        id: res.body.data.id,
        name: 'Sri Traders',
        phone: null,
        address: null,
        gstin: null,
        isActive: true,
      },
    ]);
    const audit = await expectAudit(db, {
      action: 'vendor.create',
      entity: 'vendor',
      entityId: res.body.data.id,
      actorId: userId,
    });
    expect(audit.branchId).toBe(branchId);
    expect(audit.after).toEqual({
      name: 'Sri Traders',
      phone: null,
      address: null,
      gstin: null,
      isActive: true,
    });
  });

  it('keeps the phone, address and GSTIN it is given, trimmed, with the GSTIN in upper-case', async () => {
    const { branchId, cookie } = await cashierIn();

    const res = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send(
        body({
          phone: ' 9876543210 ',
          address: ' 12 Market Road, Coimbatore ',
          gstin: ` ${GSTIN.toLowerCase()} `,
        }),
      );

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      phone: '9876543210',
      address: '12 Market Road, Coimbatore',
      gstin: GSTIN,
    });
    expect(await stored(branchId)).toMatchObject([
      { phone: '9876543210', address: '12 Market Road, Coimbatore', gstin: GSTIN },
    ]);
  });

  it('treats a blank phone, address or GSTIN as none', async () => {
    const { branchId, cookie } = await cashierIn();

    const res = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send(body({ phone: '  ', address: '', gstin: '   ' }));

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ phone: null, address: null, gstin: null });
    expect(await stored(branchId)).toMatchObject([{ phone: null, address: null, gstin: null }]);
  });

  it('ignores an isActive in the request: a new vendor is active', async () => {
    const { cookie } = await cashierIn();
    const res = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send(body({ isActive: false }));
    expect(res.status).toBe(201);
    expect(res.body.data.isActive).toBe(true);
  });

  it('allows two vendors with the same name, in one branch or in two (names are not unique)', async () => {
    const a = await cashierIn();
    const b = await cashierIn();

    const first = await request(app).post(URL).set('Cookie', a.cookie).send(body());
    const second = await request(app).post(URL).set('Cookie', a.cookie).send(body());
    const third = await request(app).post(URL).set('Cookie', b.cookie).send(body());

    expect([first.status, second.status, third.status]).toEqual([201, 201, 201]);
    expect(await namesOf(a.branchId)).toEqual(['Sri Traders', 'Sri Traders']);
    expect(await namesOf(b.branchId)).toEqual(['Sri Traders']);
  });

  it.each([
    ['too short', '33ABCDE1234F1Z'],
    ['too long', '33ABCDE1234F1Z55'],
    ['with a letter where a digit belongs', '33ABCDE12X4F1Z5'],
    ['with 0 as the entity number', '33ABCDE1234F0Z5'],
    ['without the Z in the 14th place', '33ABCDE1234F1X5'],
    ['with a space inside', '33ABCDE 234F1Z5'],
    ['not a GSTIN at all', 'not a gstin'],
  ])('refuses a GSTIN that is %s with 422 on the GSTIN, and creates nothing', async (_label, gstin) => {
    const { branchId, cookie } = await cashierIn();

    const res = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send(body({ gstin }));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      { path: 'body.gstin', message: expect.any(String) },
    ]);
    expect(await stored(branchId)).toEqual([]);
  });

  it.each([
    ['no name', { name: undefined }],
    ['a blank name', { name: '  ' }],
    ['a name that is not text', { name: 123 }],
    ['a name over 100 characters', { name: 'n'.repeat(101) }],
    ['a phone over 20 characters', { phone: '9'.repeat(21) }],
    ['an address over 200 characters', { address: 'a'.repeat(201) }],
  ])('refuses %s with 422', async (_label, overrides) => {
    const { branchId, cookie } = await cashierIn();
    const res = await request(app).post(URL).set('Cookie', cookie).send(body(overrides));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await stored(branchId)).toEqual([]);
  });
});

describe('GET /vendors', () => {
  it("lists the branch's vendors by name, ignoring case, and never another branch's", async () => {
    const { branchId, cookie } = await cashierIn();
    const other = await createBranch(pool);
    await createVendor(pool, branchId, { name: 'sri traders', phone: '9876543210' });
    await createVendor(pool, branchId, {
      name: 'Anand Agencies',
      gstin: GSTIN,
      address: '5 Lake Road',
    });
    await createVendor(pool, branchId, { name: 'Murugan Stores' });
    await createVendor(pool, other, { name: 'Other Branch Vendor' });

    const res = await request(app).get(URL).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.items.map((vendor: { name: string }) => vendor.name)).toEqual([
      'Anand Agencies',
      'Murugan Stores',
      'sri traders',
    ]);
    expect(res.body.data.items[0]).toEqual({
      id: expect.any(Number),
      name: 'Anand Agencies',
      phone: null,
      address: '5 Lake Road',
      gstin: GSTIN,
      isActive: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('searches the name: any part of it, in any case', async () => {
    const { branchId, cookie } = await cashierIn();
    await createVendor(pool, branchId, { name: 'Sri Murugan Traders' });
    await createVendor(pool, branchId, { name: 'MURUGAN Agencies' });
    await createVendor(pool, branchId, { name: 'Anand Stores' });

    const res = await request(app).get(`${URL}?search=murugan`).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.items.map((vendor: { name: string }) => vendor.name)).toEqual([
      'MURUGAN Agencies',
      'Sri Murugan Traders',
    ]);
  });

  it('treats % and _ in the search as plain characters, not wildcards', async () => {
    const { branchId, cookie } = await cashierIn();
    await createVendor(pool, branchId, { name: '100% Pure Oils' });
    await createVendor(pool, branchId, { name: 'Plain Traders' });
    await createVendor(pool, branchId, { name: 'A_B Agencies' });

    const percent = await request(app)
      .get(`${URL}?search=${encodeURIComponent('%')}`)
      .set('Cookie', cookie);
    const underscore = await request(app).get(`${URL}?search=_`).set('Cookie', cookie);

    expect(percent.body.data.items.map((vendor: { name: string }) => vendor.name)).toEqual([
      '100% Pure Oils',
    ]);
    expect(underscore.body.data.items.map((vendor: { name: string }) => vendor.name)).toEqual([
      'A_B Agencies',
    ]);
  });

  it('searches only the active branch', async () => {
    const { cookie } = await cashierIn();
    const other = await createBranch(pool);
    await createVendor(pool, other, { name: 'Sri Traders' });

    const res = await request(app).get(`${URL}?search=sri`).set('Cookie', cookie);

    expect(res.body.data).toMatchObject({ total: 0, items: [] });
  });

  it('shows deactivated vendors only when asked: active=false lists them, active=true hides them, no filter shows both', async () => {
    const { branchId, cookie } = await cashierIn();
    await createVendor(pool, branchId, { name: 'Active Vendor' });
    await createVendor(pool, branchId, { name: 'Old Vendor', isActive: false });

    const inactive = await request(app).get(`${URL}?active=false`).set('Cookie', cookie);
    const active = await request(app).get(`${URL}?active=true`).set('Cookie', cookie);
    const both = await request(app).get(URL).set('Cookie', cookie);

    expect(inactive.body.data.items.map((vendor: { name: string }) => vendor.name)).toEqual([
      'Old Vendor',
    ]);
    expect(active.body.data.items.map((vendor: { name: string }) => vendor.name)).toEqual([
      'Active Vendor',
    ]);
    expect(both.body.data.total).toBe(2);
  });

  it('pages with limit and offset', async () => {
    const { branchId, cookie } = await cashierIn();
    for (const name of ['A', 'B', 'C', 'D', 'E']) await createVendor(pool, branchId, { name });

    const res = await request(app).get(`${URL}?limit=2&offset=2`).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 5, limit: 2, offset: 2 });
    expect(res.body.data.items.map((vendor: { name: string }) => vendor.name)).toEqual(['C', 'D']);
  });

  it.each([['limit=500'], ['offset=-1'], ['active=maybe'], [`search=${'s'.repeat(101)}`]])(
    'refuses ?%s with 422',
    async (query) => {
      const { cookie } = await cashierIn();
      const res = await request(app).get(`${URL}?${query}`).set('Cookie', cookie);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    },
  );
});

describe('PATCH /vendors/:id', () => {
  it('edits the fields it is given and audits the old and new values of only those', async () => {
    const { userId, branchId, cookie } = await cashierIn();
    const id = await createVendor(pool, branchId, {
      name: 'Sri Tradres',
      phone: '111',
      address: '1 Old Road',
    });

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ name: ' Sri Traders ', phone: '9876543210', gstin: GSTIN.toLowerCase() });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id,
      name: 'Sri Traders',
      phone: '9876543210',
      address: '1 Old Road',
      gstin: GSTIN,
    });
    expect(await stored(branchId)).toEqual([
      {
        id,
        name: 'Sri Traders',
        phone: '9876543210',
        address: '1 Old Road',
        gstin: GSTIN,
        isActive: true,
      },
    ]);
    const audit = await expectAudit(db, {
      action: 'vendor.update',
      entity: 'vendor',
      entityId: id,
      actorId: userId,
    });
    expect(audit.branchId).toBe(branchId);
    expect(audit.before).toEqual({ name: 'Sri Tradres', phone: '111', gstin: null });
    expect(audit.after).toEqual({ name: 'Sri Traders', phone: '9876543210', gstin: GSTIN });
  });

  it('clears the phone, address and GSTIN with null', async () => {
    const { branchId, cookie } = await cashierIn();
    const id = await createVendor(pool, branchId, {
      phone: '9876543210',
      address: '1 Old Road',
      gstin: GSTIN,
    });

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ phone: null, address: null, gstin: null });

    expect(res.status).toBe(200);
    expect(await stored(branchId)).toMatchObject([{ phone: null, address: null, gstin: null }]);
    const audit = await expectAudit(db, { action: 'vendor.update', entityId: id });
    expect(audit.before).toEqual({ phone: '9876543210', address: '1 Old Road', gstin: GSTIN });
    expect(audit.after).toEqual({ phone: null, address: null, gstin: null });
  });

  it('does nothing, and records nothing, when no field really changes', async () => {
    const { branchId, cookie } = await cashierIn();
    const id = await createVendor(pool, branchId, { name: 'Sri Traders', phone: '111' });

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ name: ' Sri Traders ', phone: '111' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id, name: 'Sri Traders', phone: '111' });
    expect(await auditCount('vendor.update')).toBe(0);
  });

  it('deactivates a vendor, then reactivates it, auditing each', async () => {
    const { branchId, cookie } = await cashierIn();
    const id = await createVendor(pool, branchId, { name: 'Sri Traders', phone: '111' });

    const off = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ isActive: false });

    expect(off.status).toBe(200);
    expect(off.body.data).toMatchObject({ isActive: false, name: 'Sri Traders', phone: '111' });
    expect(await stored(branchId)).toMatchObject([{ isActive: false }]);
    const deactivated = await expectAudit(db, { action: 'vendor.deactivate', entityId: id });
    expect(deactivated.before).toEqual({ isActive: true });
    expect(deactivated.after).toEqual({ isActive: false });

    const on = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ isActive: true });

    expect(on.status).toBe(200);
    expect(on.body.data.isActive).toBe(true);
    await expectAudit(db, { action: 'vendor.activate', entityId: id });
  });

  it('refuses an invalid GSTIN with 422 on the GSTIN, and changes nothing', async () => {
    const { branchId, cookie } = await cashierIn();
    const id = await createVendor(pool, branchId, { gstin: GSTIN });

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ gstin: '33ABCDE1234F1Z' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      { path: 'body.gstin', message: expect.any(String) },
    ]);
    expect(await stored(branchId)).toMatchObject([{ gstin: GSTIN }]);
    expect(await auditCount('vendor.update')).toBe(0);
  });

  it("answers 404 for another branch's vendor and changes nothing (branch isolation)", async () => {
    const a = await cashierIn();
    const other = await createBranch(pool);
    const foreign = await createVendor(pool, other, { name: 'Other Branch Vendor' });

    const res = await request(app)
      .patch(`${URL}/${foreign}`)
      .set('Cookie', a.cookie)
      .send({ name: 'Hacked', isActive: false });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(await stored(other)).toMatchObject([{ name: 'Other Branch Vendor', isActive: true }]);
    expect(await auditCount('vendor.update')).toBe(0);
    expect(await auditCount('vendor.deactivate')).toBe(0);
  });

  it('answers 404 for a vendor that does not exist', async () => {
    const { cookie } = await cashierIn();
    const res = await request(app).patch(`${URL}/999999`).set('Cookie', cookie).send({ name: 'x' });
    expect(res.status).toBe(404);
  });

  it.each(['abc', '0', '1.5'])('refuses the id %j with 422', async (id) => {
    const { cookie } = await cashierIn();
    const res = await request(app).patch(`${URL}/${id}`).set('Cookie', cookie).send({ name: 'x' });
    expect(res.status).toBe(422);
  });

  it.each([
    ['an empty body', {}],
    ['a blank name', { name: ' ' }],
    ['an isActive that is not true or false', { isActive: 'no' }],
    ['a phone over 20 characters', { phone: '9'.repeat(21) }],
  ])('refuses %s with 422 and changes nothing', async (_label, patch) => {
    const { branchId, cookie } = await cashierIn();
    const id = await createVendor(pool, branchId, { name: 'Sri Traders' });
    const res = await request(app).patch(`${URL}/${id}`).set('Cookie', cookie).send(patch);
    expect(res.status).toBe(422);
    expect(await stored(branchId)).toMatchObject([{ name: 'Sri Traders', phone: null }]);
  });
});
