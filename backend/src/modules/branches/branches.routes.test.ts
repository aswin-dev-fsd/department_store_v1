import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { expectAudit } from '../../../test/helpers/audit.js';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import { cookieFor, createBranch, createUser, mapUser } from '../../../test/helpers/fixtures.js';
import { createApp } from '../../app.js';

const { db, pool } = createTestDb();
const app = createApp({ db });
const URL = '/api/v1/admin/branches';

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

/** An admin's Cookie header. */
async function adminCookie(): Promise<{ adminId: number; cookie: string }> {
  const adminId = await createUser(pool, { role: 'admin', username: 'boss' });
  return { adminId, cookie: await cookieFor(db, adminId) };
}

const tiruppur = { code: 'TPR', name: 'Tiruppur', address: '12 Main Road, Tiruppur' };

describe('access control', () => {
  const routes = [
    ['GET', URL],
    ['POST', URL],
    ['PATCH', `${URL}/1`],
  ] as const;

  const call = (method: (typeof routes)[number][0], path: string) => {
    const agent = request(app);
    return method === 'GET'
      ? agent.get(path)
      : method === 'POST'
        ? agent.post(path)
        : agent.patch(path);
  };

  it.each(routes)('%s %s answers 401 without a session', async (method, path) => {
    const res = await call(method, path);
    expect(res.status).toBe(401);
  });

  it.each(routes)('%s %s answers 403 FORBIDDEN to a cashier', async (method, path) => {
    const cashierId = await createUser(pool, { role: 'cashier' });
    const branchId = await createBranch(pool);
    await mapUser(pool, cashierId, branchId);
    const cookie = await cookieFor(db, cashierId, branchId);

    const res = await call(method, path)
      .set('Cookie', cookie)
      .send({ ...tiruppur, name: 'Hacked' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('POST /admin/branches', () => {
  it('creates a branch (code upper-cased), starts it active, and audits it', async () => {
    const { adminId, cookie } = await adminCookie();

    const res = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send({ ...tiruppur, code: ' tpr ' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      id: expect.any(Number),
      ...tiruppur,
      phone: null,
      billFooter: null,
      isActive: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    const id = res.body.data.id as number;
    const audit = await expectAudit(db, {
      action: 'branch.create',
      entity: 'branch',
      entityId: id,
      actorId: adminId,
    });
    expect(audit.branchId).toBe(id);
    expect(audit.before).toBeNull();
    expect(audit.after).toEqual({ ...tiruppur, phone: null, billFooter: null, isActive: true });
  });

  it('stores Tamil text, a phone number and a multi-line bill footer', async () => {
    const { cookie } = await adminCookie();
    const res = await request(app).post(URL).set('Cookie', cookie).send({
      code: 'CBE',
      name: 'கோவை கிளை',
      address: 'ஆர்.எஸ். புரம், கோவை',
      phone: '0422-2345678',
      billFooter: 'நன்றி\nமீண்டும் வருக',
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'கோவை கிளை',
      phone: '0422-2345678',
      billFooter: 'நன்றி\nமீண்டும் வருக',
    });
  });

  it.each([['TPRX'], ['T1'], ['T R'], ['']])('refuses the code %j with 422', async (code) => {
    const { cookie } = await adminCookie();
    const res = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send({ ...tiruppur, code });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('body.code');
  });

  it('requires a code, a name and an address', async () => {
    const { cookie } = await adminCookie();
    const res = await request(app).post(URL).set('Cookie', cookie).send({ phone: '1' });
    expect(res.status).toBe(422);
    const paths = res.body.error.details.map((d: { path: string }) => d.path).sort();
    expect(paths).toEqual(['body.address', 'body.code', 'body.name']);
  });

  it('refuses a duplicate code with 400 DUPLICATE_CODE — in any letter case — and adds nothing', async () => {
    const { cookie } = await adminCookie();
    await request(app).post(URL).set('Cookie', cookie).send(tiruppur).expect(201);

    for (const code of ['TPR', 'tpr']) {
      const res = await request(app)
        .post(URL)
        .set('Cookie', cookie)
        .send({ ...tiruppur, code, name: 'Another' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('DUPLICATE_CODE');
    }
    const { rows } = await pool.query(
      `select (select count(*)::int from branches) as branches,
              (select count(*)::int from audit_logs where action = 'branch.create') as audits`,
    );
    expect(rows[0]).toEqual({ branches: 1, audits: 1 });
  });

  it('lets exactly one of two simultaneous creates win; the other gets DUPLICATE_CODE, not a 500', async () => {
    const { cookie } = await adminCookie();
    const results = await Promise.all([
      request(app).post(URL).set('Cookie', cookie).send(tiruppur),
      request(app)
        .post(URL)
        .set('Cookie', cookie)
        .send({ ...tiruppur, name: 'Second' }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(results.find((r) => r.status === 400)?.body.error.code).toBe('DUPLICATE_CODE');
    const { rows } = await pool.query('select count(*)::int as n from branches');
    expect(rows[0]).toEqual({ n: 1 });
  });
});

describe('GET /admin/branches', () => {
  async function seed() {
    await createBranch(pool, { code: 'CBE', name: 'Coimbatore' });
    await createBranch(pool, { code: 'ERD', name: 'Erode', isActive: false });
    await createBranch(pool, { code: 'TPR', name: 'Tiruppur' });
  }

  it('lists every branch, active or not, ordered by code, with a total', async () => {
    await seed();
    const { cookie } = await adminCookie();
    const res = await request(app).get(URL).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 3, limit: 20, offset: 0 });
    expect(res.body.data.items.map((b: { code: string }) => b.code)).toEqual(['CBE', 'ERD', 'TPR']);
    expect(res.body.data.items[1]).toMatchObject({ code: 'ERD', isActive: false });
  });

  it('pages with limit and offset, and reports the full total', async () => {
    await seed();
    const { cookie } = await adminCookie();
    const res = await request(app).get(`${URL}?limit=1&offset=1`).set('Cookie', cookie);

    expect(res.body.data).toMatchObject({ total: 3, limit: 1, offset: 1 });
    expect(res.body.data.items.map((b: { code: string }) => b.code)).toEqual(['ERD']);

    const past = await request(app).get(`${URL}?offset=10`).set('Cookie', cookie);
    expect(past.body.data).toMatchObject({ items: [], total: 3 });
  });

  it('filters by isActive', async () => {
    await seed();
    const { cookie } = await adminCookie();
    const active = await request(app).get(`${URL}?isActive=true`).set('Cookie', cookie);
    expect(active.body.data.items.map((b: { code: string }) => b.code)).toEqual(['CBE', 'TPR']);
    expect(active.body.data.total).toBe(2);

    const inactive = await request(app).get(`${URL}?isActive=false`).set('Cookie', cookie);
    expect(inactive.body.data.items.map((b: { code: string }) => b.code)).toEqual(['ERD']);
  });

  it.each([['limit=0'], ['limit=101'], ['limit=abc'], ['offset=-1'], ['isActive=maybe']])(
    'refuses ?%s with 422',
    async (query) => {
      const { cookie } = await adminCookie();
      const res = await request(app).get(`${URL}?${query}`).set('Cookie', cookie);
      expect(res.status).toBe(422);
    },
  );
});

describe('PATCH /admin/branches/:id', () => {
  async function createdBranch(cookie: string) {
    const res = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send({ ...tiruppur, phone: '0421-111' });
    return res.body.data as { id: number; updatedAt: string };
  }

  it('edits fields and audits only what changed', async () => {
    const { adminId, cookie } = await adminCookie();
    const { id, updatedAt } = await createdBranch(cookie);

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ name: 'Tiruppur Main', address: '12 Main Road, Tiruppur', phone: '0421-222' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id, name: 'Tiruppur Main', phone: '0421-222' });
    expect(new Date(res.body.data.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(updatedAt).getTime(),
    );

    const audit = await expectAudit(db, {
      action: 'branch.update',
      entity: 'branch',
      entityId: id,
      actorId: adminId,
    });
    expect(audit.before).toEqual({ name: 'Tiruppur', phone: '0421-111' });
    expect(audit.after).toEqual({ name: 'Tiruppur Main', phone: '0421-222' });
  });

  it('clears the phone and bill footer with null or an empty string', async () => {
    const { cookie } = await adminCookie();
    const { id } = await createdBranch(cookie);

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ phone: null, billFooter: '' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ phone: null, billFooter: null });
  });

  it('does nothing — and writes no audit row — when no value actually changes', async () => {
    const { cookie } = await adminCookie();
    const { id } = await createdBranch(cookie);
    const before = await pool.query(`select count(*)::int as n from audit_logs`);

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ name: 'Tiruppur', code: 'tpr', isActive: true });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Tiruppur');
    const after = await pool.query(`select count(*)::int as n from audit_logs`);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('refuses an empty body with 422', async () => {
    const { cookie } = await adminCookie();
    const { id } = await createdBranch(cookie);
    const res = await request(app).patch(`${URL}/${id}`).set('Cookie', cookie).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].message).toMatch(/at least one field/i);
  });

  it('changes the code, but not to one another branch already uses', async () => {
    const { cookie } = await adminCookie();
    const { id } = await createdBranch(cookie);
    await createBranch(pool, { code: 'CBE' });

    const taken = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ code: 'cbe' });
    expect(taken.status).toBe(400);
    expect(taken.body.error.code).toBe('DUPLICATE_CODE');

    const free = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ code: 'ERD' });
    expect(free.status).toBe(200);
    expect(free.body.data.code).toBe('ERD');
    const audit = await expectAudit(db, { action: 'branch.update', entityId: id });
    expect(audit.before).toEqual({ code: 'TPR' });
    expect(audit.after).toEqual({ code: 'ERD' });
  });

  it('deactivates and reactivates a branch, with their own audit actions', async () => {
    const { adminId, cookie } = await adminCookie();
    const { id } = await createdBranch(cookie);

    const off = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ isActive: false });
    expect(off.body.data.isActive).toBe(false);
    const deactivated = await expectAudit(db, {
      action: 'branch.deactivate',
      entityId: id,
      actorId: adminId,
    });
    expect(deactivated.before).toEqual({ isActive: true });
    expect(deactivated.after).toEqual({ isActive: false });

    // Still listed, so it can be switched back on
    const listed = await request(app).get(URL).set('Cookie', cookie);
    expect(listed.body.data.items).toHaveLength(1);

    const on = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ isActive: true });
    expect(on.body.data.isActive).toBe(true);
    await expectAudit(db, { action: 'branch.activate', entityId: id });
  });

  it('takes the branch away from a cashier working in it, immediately', async () => {
    const { cookie } = await adminCookie();
    const tpr = await createBranch(pool, { code: 'TPR' });
    const cbe = await createBranch(pool, { code: 'CBE' });
    const cashierId = await createUser(pool, { role: 'cashier' });
    await mapUser(pool, cashierId, tpr);
    await mapUser(pool, cashierId, cbe);
    const cashierCookie = await cookieFor(db, cashierId, tpr);

    const working = await request(app).get('/api/v1/auth/me').set('Cookie', cashierCookie);
    expect(working.body.data).toMatchObject({ activeBranchId: tpr, needsBranchSelection: false });

    await request(app)
      .patch(`${URL}/${tpr}`)
      .set('Cookie', cookie)
      .send({ isActive: false })
      .expect(200);

    const after = await request(app).get('/api/v1/auth/me').set('Cookie', cashierCookie);
    expect(after.body.data.activeBranchId).toBeNull();
    expect(after.body.data.needsBranchSelection).toBe(true);
    expect(after.body.data.branches.map((b: { code: string }) => b.code)).toEqual(['CBE']);
  });

  it('answers 404 for an unknown branch and 422 for a malformed id', async () => {
    const { cookie } = await adminCookie();
    const missing = await request(app)
      .patch(`${URL}/99999`)
      .set('Cookie', cookie)
      .send({ name: 'x' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');

    for (const id of ['abc', '0', '-1', '1.5']) {
      const res = await request(app)
        .patch(`${URL}/${id}`)
        .set('Cookie', cookie)
        .send({ name: 'x' });
      expect(res.status).toBe(422);
    }
  });
});
