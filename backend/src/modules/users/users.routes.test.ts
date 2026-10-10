import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { expectAudit } from '../../../test/helpers/audit.js';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import { cookieFor, createBranch, createUser, mapUser } from '../../../test/helpers/fixtures.js';
import { createApp } from '../../app.js';

const { db, pool } = createTestDb();
const app = createApp({ db });
const BASE = '/api/v1/admin/users';

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

async function adminCookie(): Promise<{ adminId: number; cookie: string }> {
  const adminId = await createUser(pool, { role: 'admin', username: 'boss' });
  return { adminId, cookie: await cookieFor(db, adminId) };
}

interface Created {
  user: { id: number; username: string };
  temporaryPassword: string;
}

/** Create a user through the API, so it has a real password hash we can log in with. */
async function createViaApi(
  cookie: string,
  body: { username: string; fullName?: string; role?: 'admin' | 'cashier' },
): Promise<Created> {
  const res = await request(app)
    .post(BASE)
    .set('Cookie', cookie)
    .send({ fullName: `Full ${body.username}`, role: 'cashier', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as Created;
}

/** Log in and return the session's Cookie header value. */
async function loginCookie(username: string, password: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ username, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return String(res.headers['set-cookie']).split(';')[0]!;
}

async function mappedCodes(userId: number): Promise<string[]> {
  const { rows } = await pool.query<{ code: string }>(
    `select b.code from user_branches ub join branches b on b.id = ub.branch_id
     where ub.user_id = $1 order by b.code`,
    [userId],
  );
  return rows.map((r) => r.code);
}

async function auditCount(): Promise<number> {
  const { rows } = await pool.query(`select count(*)::int as n from audit_logs`);
  return rows[0].n;
}

describe('access control', () => {
  const routes = [
    ['GET', BASE],
    ['POST', BASE],
    ['PATCH', `${BASE}/1`],
    ['POST', `${BASE}/1/reset-password`],
    ['PUT', `${BASE}/1/branches`],
  ] as const;

  const call = (method: (typeof routes)[number][0], path: string) => {
    const agent = request(app);
    switch (method) {
      case 'GET':
        return agent.get(path);
      case 'POST':
        return agent.post(path);
      case 'PATCH':
        return agent.patch(path);
      case 'PUT':
        return agent.put(path);
    }
  };

  it.each(routes)('%s %s answers 401 without a session', async (method, path) => {
    expect((await call(method, path)).status).toBe(401);
  });

  it.each(routes)('%s %s answers 403 FORBIDDEN to a cashier', async (method, path) => {
    const cashierId = await createUser(pool, { role: 'cashier' });
    const branchId = await createBranch(pool);
    await mapUser(pool, cashierId, branchId);
    const cookie = await cookieFor(db, cashierId, branchId);

    const res = await call(method, path).set('Cookie', cookie).send({ fullName: 'Hacked' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('POST /admin/users', () => {
  it('creates a cashier with a one-time temporary password that really works, and audits it', async () => {
    const { adminId, cookie } = await adminCookie();

    const res = await request(app)
      .post(BASE)
      .set('Cookie', cookie)
      .send({ username: ' Ravi.K ', fullName: 'Ravi Kumar', role: 'cashier' });

    expect(res.status).toBe(201);
    const { user, temporaryPassword } = res.body.data;
    expect(temporaryPassword).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(user).toMatchObject({
      id: expect.any(Number),
      username: 'ravi.k',
      fullName: 'Ravi Kumar',
      role: 'cashier',
      isActive: true,
      mustChangePassword: true,
      lastLoginAt: null,
      branches: [],
    });
    expect(user).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/); // no bcrypt hash anywhere

    // The password it returned logs in, and a change is demanded
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'ravi.k', password: temporaryPassword });
    expect(login.status).toBe(200);
    expect(login.body.data.user.mustChangePassword).toBe(true);

    const audit = await expectAudit(db, {
      action: 'user.create',
      entity: 'user',
      entityId: user.id,
      actorId: adminId,
    });
    expect(audit.after).toEqual({
      username: 'ravi.k',
      fullName: 'Ravi Kumar',
      role: 'cashier',
      isActive: true,
      mustChangePassword: true,
    });
    expect(JSON.stringify(audit)).not.toContain(temporaryPassword);
  });

  it('can create an Admin, with a Tamil name', async () => {
    const { cookie } = await adminCookie();
    const res = await request(app)
      .post(BASE)
      .set('Cookie', cookie)
      .send({ username: 'second.admin', fullName: 'ரவி குமார்', role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ role: 'admin', fullName: 'ரவி குமார்' });
  });

  it.each([
    [{ username: 'a b', fullName: 'X', role: 'cashier' }, 'body.username'],
    [{ username: 'ab', fullName: 'X', role: 'cashier' }, 'body.username'],
    [{ username: 'ravi', fullName: '  ', role: 'cashier' }, 'body.fullName'],
    [{ username: 'ravi', fullName: 'X', role: 'owner' }, 'body.role'],
    [{ username: 'ravi', fullName: 'X' }, 'body.role'],
  ])('refuses %j with 422 (%s)', async (body, path) => {
    const { cookie } = await adminCookie();
    const res = await request(app).post(BASE).set('Cookie', cookie).send(body);
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].path).toBe(path);
  });

  it('refuses a duplicate username, in any letter case, with 400 DUPLICATE_USERNAME', async () => {
    const { cookie } = await adminCookie();
    await createViaApi(cookie, { username: 'ravi' });
    const audits = await auditCount();

    for (const username of ['ravi', 'RAVI']) {
      const res = await request(app)
        .post(BASE)
        .set('Cookie', cookie)
        .send({ username, fullName: 'Another Ravi', role: 'cashier' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('DUPLICATE_USERNAME');
    }
    expect(await auditCount()).toBe(audits);
    const { rows } = await pool.query(`select count(*)::int as n from users`);
    expect(rows[0]).toEqual({ n: 2 }); // the admin and ravi
  });

  it('lets exactly one of two simultaneous creates of a username win, not a 500', async () => {
    const { cookie } = await adminCookie();
    const body = { username: 'ravi', fullName: 'Ravi', role: 'cashier' };
    const results = await Promise.all([
      request(app).post(BASE).set('Cookie', cookie).send(body),
      request(app).post(BASE).set('Cookie', cookie).send(body),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(results.find((r) => r.status === 400)?.body.error.code).toBe('DUPLICATE_USERNAME');
  });
});

describe('GET /admin/users', () => {
  async function seed() {
    const cbe = await createBranch(pool, { code: 'CBE' });
    const tpr = await createBranch(pool, { code: 'TPR' });
    const old = await createBranch(pool, { code: 'OLD', isActive: false });
    const alice = await createUser(pool, { username: 'alice', role: 'cashier' });
    for (const branch of [tpr, cbe, old]) await mapUser(pool, alice, branch);
    await createUser(pool, { username: 'bob', role: 'cashier', isActive: false });
    await createUser(pool, { username: 'Carol', role: 'admin' });
    return { alice };
  }

  it('lists users ordered by username with their branches, flagging inactive ones', async () => {
    await seed();
    const { cookie } = await adminCookie(); // adds the admin "boss"
    const res = await request(app).get(BASE).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 4, limit: 20, offset: 0 });
    const names = res.body.data.items.map((u: { username: string }) => u.username);
    expect(names).toEqual(['alice', 'bob', 'boss', 'Carol']); // case-insensitive order

    const alice = res.body.data.items[0];
    expect(alice.branches.map((b: { code: string }) => b.code)).toEqual(['CBE', 'OLD', 'TPR']);
    expect(alice.branches.find((b: { code: string }) => b.code === 'OLD').isActive).toBe(false);
    expect(alice.branches[0]).toEqual({
      id: expect.any(Number),
      code: 'CBE',
      name: 'Branch CBE',
      isActive: true,
    });
    expect(res.body.data.items[1].branches).toEqual([]);
  });

  it('never exposes a password hash', async () => {
    await seed();
    const { cookie } = await adminCookie();
    const res = await request(app).get(BASE).set('Cookie', cookie);
    // "mustChangePassword" is a flag, so look for a hash field or an actual bcrypt hash
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash|\$2[aby]\$/);
    expect(res.body.data.items[0]).not.toHaveProperty('passwordHash');
  });

  it('pages with limit and offset, and reports the full total', async () => {
    await seed();
    const { cookie } = await adminCookie();
    const res = await request(app).get(`${BASE}?limit=2&offset=1`).set('Cookie', cookie);
    expect(res.body.data).toMatchObject({ total: 4, limit: 2, offset: 1 });
    expect(res.body.data.items.map((u: { username: string }) => u.username)).toEqual([
      'bob',
      'boss',
    ]);
  });

  it('filters by role and by isActive', async () => {
    await seed();
    const { cookie } = await adminCookie();
    const admins = await request(app).get(`${BASE}?role=admin`).set('Cookie', cookie);
    expect(admins.body.data.items.map((u: { username: string }) => u.username)).toEqual([
      'boss',
      'Carol',
    ]);
    const inactive = await request(app).get(`${BASE}?isActive=false`).set('Cookie', cookie);
    expect(inactive.body.data.items.map((u: { username: string }) => u.username)).toEqual(['bob']);
    expect(inactive.body.data.total).toBe(1);
  });

  it.each([['limit=0'], ['offset=-1'], ['role=owner'], ['isActive=maybe']])(
    'refuses ?%s with 422',
    async (query) => {
      const { cookie } = await adminCookie();
      const res = await request(app).get(`${BASE}?${query}`).set('Cookie', cookie);
      expect(res.status).toBe(422);
    },
  );
});

describe('PATCH /admin/users/:id', () => {
  it('edits the full name and audits only what changed', async () => {
    const { adminId, cookie } = await adminCookie();
    const userId = await createUser(pool, { username: 'ravi', fullName: 'Ravi' });

    const res = await request(app)
      .patch(`${BASE}/${userId}`)
      .set('Cookie', cookie)
      .send({ fullName: ' Ravi Kumar ' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: userId, fullName: 'Ravi Kumar', username: 'ravi' });
    const audit = await expectAudit(db, {
      action: 'user.update',
      entity: 'user',
      entityId: userId,
      actorId: adminId,
    });
    expect(audit.before).toEqual({ fullName: 'Ravi' });
    expect(audit.after).toEqual({ fullName: 'Ravi Kumar' });
  });

  it('does nothing, and writes no audit row, when no value changes', async () => {
    const { cookie } = await adminCookie();
    const userId = await createUser(pool, { username: 'ravi', fullName: 'Ravi' });
    const before = await auditCount();

    const res = await request(app)
      .patch(`${BASE}/${userId}`)
      .set('Cookie', cookie)
      .send({ fullName: 'Ravi', isActive: true });
    expect(res.status).toBe(200);
    expect(await auditCount()).toBe(before);
  });

  it('refuses an empty body with 422, and cannot change the role or username', async () => {
    const { cookie } = await adminCookie();
    const userId = await createUser(pool, { username: 'ravi', role: 'cashier' });

    const empty = await request(app).patch(`${BASE}/${userId}`).set('Cookie', cookie).send({});
    expect(empty.status).toBe(422);

    const sneaky = await request(app)
      .patch(`${BASE}/${userId}`)
      .set('Cookie', cookie)
      .send({ fullName: 'Ravi K', role: 'admin', username: 'root' });
    expect(sneaky.status).toBe(200);
    const { rows } = await pool.query('select username, role from users where id = $1', [userId]);
    expect(rows[0]).toEqual({ username: 'ravi', role: 'cashier' });
  });

  it('deactivates a user: their session ends at once and they cannot log in; reactivating restores login', async () => {
    const { adminId, cookie } = await adminCookie();
    const { user, temporaryPassword } = await createViaApi(cookie, { username: 'ravi' });
    const userCookie = await loginCookie('ravi', temporaryPassword);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', userCookie)).status).toBe(200);

    const off = await request(app)
      .patch(`${BASE}/${user.id}`)
      .set('Cookie', cookie)
      .send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.data.isActive).toBe(false);

    // Their sessions are deleted at once, not left to be noticed on their next use
    const left = await pool.query('select count(*)::int as n from sessions where user_id = $1', [
      user.id,
    ]);
    expect(left.rows[0]).toEqual({ n: 0 });

    // The very next request with the old session is refused
    const after = await request(app).get('/api/v1/auth/me').set('Cookie', userCookie);
    expect(after.status).toBe(401);
    // And so is a fresh login
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'ravi', password: temporaryPassword });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe('INVALID_CREDENTIALS');

    const deactivated = await expectAudit(db, {
      action: 'user.deactivate',
      entityId: user.id,
      actorId: adminId,
    });
    expect(deactivated.before).toEqual({ isActive: true });
    expect(deactivated.after).toEqual({ isActive: false });

    const on = await request(app)
      .patch(`${BASE}/${user.id}`)
      .set('Cookie', cookie)
      .send({ isActive: true });
    expect(on.body.data.isActive).toBe(true);
    await expectAudit(db, { action: 'user.activate', entityId: user.id });
    await loginCookie('ravi', temporaryPassword); // works again
  });

  it('does not bring a user’s old sessions back to life when they are reactivated', async () => {
    const { cookie } = await adminCookie();
    const { user, temporaryPassword } = await createViaApi(cookie, { username: 'ravi' });
    const oldCookie = await loginCookie('ravi', temporaryPassword);

    // Deactivated, and nobody touches the old session meanwhile; then reactivated
    for (const isActive of [false, true]) {
      await request(app)
        .patch(`${BASE}/${user.id}`)
        .set('Cookie', cookie)
        .send({ isActive })
        .expect(200);
    }

    expect((await request(app).get('/api/v1/auth/me').set('Cookie', oldCookie)).status).toBe(401);
  });

  it('will not deactivate your own account (so an active Admin always remains)', async () => {
    const { adminId, cookie } = await adminCookie();
    const audits = await auditCount();

    const res = await request(app)
      .patch(`${BASE}/${adminId}`)
      .set('Cookie', cookie)
      .send({ isActive: false });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_DEACTIVATE_SELF');
    const { rows } = await pool.query('select is_active from users where id = $1', [adminId]);
    expect(rows[0]).toEqual({ is_active: true });
    expect(await auditCount()).toBe(audits);
  });

  it('answers 404 for an unknown user and 422 for a malformed id', async () => {
    const { cookie } = await adminCookie();
    const missing = await request(app)
      .patch(`${BASE}/99999`)
      .set('Cookie', cookie)
      .send({ fullName: 'x' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');

    for (const id of ['abc', '0', '-1']) {
      const res = await request(app)
        .patch(`${BASE}/${id}`)
        .set('Cookie', cookie)
        .send({ fullName: 'x' });
      expect(res.status).toBe(422);
    }
  });
});

describe('POST /admin/users/:id/reset-password', () => {
  it('sets a new temporary password, ends the user’s sessions, demands a change, and audits without the password', async () => {
    const { adminId, cookie } = await adminCookie();
    const { user, temporaryPassword: first } = await createViaApi(cookie, { username: 'ravi' });
    const userCookie = await loginCookie('ravi', first);

    const res = await request(app).post(`${BASE}/${user.id}/reset-password`).set('Cookie', cookie);

    expect(res.status).toBe(200);
    const second = res.body.data.temporaryPassword as string;
    expect(second).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(second).not.toBe(first);
    expect(Object.keys(res.body.data)).toEqual(['temporaryPassword']);

    // Old session and old password are dead; the new password works and demands a change
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', userCookie)).status).toBe(401);
    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'ravi', password: first });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'ravi', password: second });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.data.user.mustChangePassword).toBe(true);

    const audit = await expectAudit(db, {
      action: 'user.reset_password',
      entity: 'user',
      entityId: user.id,
      actorId: adminId,
    });
    expect(audit.before).toEqual({ mustChangePassword: true });
    expect(audit.after).toEqual({ mustChangePassword: true, sessionsEnded: 1 });
    expect(JSON.stringify(audit)).not.toMatch(new RegExp(`${first}|${second}`));
  });

  it('will not reset your own password: use change-password for that', async () => {
    const { adminId, cookie } = await adminCookie();
    const res = await request(app).post(`${BASE}/${adminId}/reset-password`).set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_RESET_OWN_PASSWORD');
    // Still logged in
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(200);
  });

  it('answers 404 for an unknown user and 422 for a malformed id', async () => {
    const { cookie } = await adminCookie();
    expect(
      (await request(app).post(`${BASE}/99999/reset-password`).set('Cookie', cookie)).status,
    ).toBe(404);
    expect(
      (await request(app).post(`${BASE}/abc/reset-password`).set('Cookie', cookie)).status,
    ).toBe(422);
  });
});

describe('PUT /admin/users/:id/branches', () => {
  it('replaces the whole mapping, answers the user with their branches, and audits ids and codes', async () => {
    const { adminId, cookie } = await adminCookie();
    const cbe = await createBranch(pool, { code: 'CBE' });
    const erd = await createBranch(pool, { code: 'ERD' });
    const tpr = await createBranch(pool, { code: 'TPR' });
    const userId = await createUser(pool, { username: 'ravi' });
    await mapUser(pool, userId, cbe);
    await mapUser(pool, userId, erd);

    const res = await request(app)
      .put(`${BASE}/${userId}/branches`)
      .set('Cookie', cookie)
      .send({ branchIds: [tpr, erd] });

    expect(res.status).toBe(200);
    expect(res.body.data.branches.map((b: { code: string }) => b.code)).toEqual(['ERD', 'TPR']);
    expect(await mappedCodes(userId)).toEqual(['ERD', 'TPR']);

    const audit = await expectAudit(db, {
      action: 'user.branches_update',
      entity: 'user',
      entityId: userId,
      actorId: adminId,
    });
    expect(audit.before).toEqual({ branchIds: [cbe, erd], branchCodes: ['CBE', 'ERD'] });
    expect(audit.after).toEqual({ branchIds: [erd, tpr], branchCodes: ['ERD', 'TPR'] });
  });

  it('is for cashiers only: an Admin gets 400 NOT_A_CASHIER', async () => {
    const { adminId, cookie } = await adminCookie();
    const branchId = await createBranch(pool);
    const res = await request(app)
      .put(`${BASE}/${adminId}/branches`)
      .set('Cookie', cookie)
      .send({ branchIds: [branchId] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_A_CASHIER');
    expect(await mappedCodes(adminId)).toEqual([]);
  });

  it('refuses to add a branch that is inactive or does not exist, naming the ids, and changes nothing', async () => {
    const { cookie } = await adminCookie();
    const open = await createBranch(pool, { code: 'TPR' });
    const closed = await createBranch(pool, { code: 'OLD', isActive: false });
    const userId = await createUser(pool, { username: 'ravi' });
    await mapUser(pool, userId, open);
    const audits = await auditCount();

    const res = await request(app)
      .put(`${BASE}/${userId}/branches`)
      .set('Cookie', cookie)
      .send({ branchIds: [open, closed, 99999] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BRANCH_NOT_AVAILABLE');
    expect(res.body.error.details).toEqual({ branchIds: [closed, 99999].sort((a, b) => a - b) });
    expect(await mappedCodes(userId)).toEqual(['TPR']);
    expect(await auditCount()).toBe(audits);
  });

  it('lets a branch that is already mapped stay after it is deactivated, so a list can be saved again', async () => {
    const { cookie } = await adminCookie();
    const keep = await createBranch(pool, { code: 'OLD' });
    const add = await createBranch(pool, { code: 'TPR' });
    const userId = await createUser(pool, { username: 'ravi' });
    await mapUser(pool, userId, keep);
    await pool.query('update branches set is_active = false where id = $1', [keep]);

    const res = await request(app)
      .put(`${BASE}/${userId}/branches`)
      .set('Cookie', cookie)
      .send({ branchIds: [keep, add] });

    expect(res.status).toBe(200);
    expect(await mappedCodes(userId)).toEqual(['OLD', 'TPR']);
  });

  it('clears the mapping with an empty list, ignores duplicates, and writes nothing when the set is unchanged', async () => {
    const { cookie } = await adminCookie();
    const tpr = await createBranch(pool, { code: 'TPR' });
    const userId = await createUser(pool, { username: 'ravi' });

    const set = await request(app)
      .put(`${BASE}/${userId}/branches`)
      .set('Cookie', cookie)
      .send({ branchIds: [tpr, tpr, tpr] });
    expect(set.status).toBe(200);
    expect(await mappedCodes(userId)).toEqual(['TPR']);

    const audits = await auditCount();
    const same = await request(app)
      .put(`${BASE}/${userId}/branches`)
      .set('Cookie', cookie)
      .send({ branchIds: [tpr] });
    expect(same.status).toBe(200);
    expect(await auditCount()).toBe(audits);

    const clear = await request(app)
      .put(`${BASE}/${userId}/branches`)
      .set('Cookie', cookie)
      .send({ branchIds: [] });
    expect(clear.status).toBe(200);
    expect(clear.body.data.branches).toEqual([]);
    expect(await mappedCodes(userId)).toEqual([]);
  });

  it('takes a branch away from a cashier who is working in it, on their next request', async () => {
    const { cookie } = await adminCookie();
    const tpr = await createBranch(pool, { code: 'TPR' });
    const cbe = await createBranch(pool, { code: 'CBE' });
    const userId = await createUser(pool, { username: 'ravi' });
    await mapUser(pool, userId, tpr);
    await mapUser(pool, userId, cbe);
    const cashierCookie = await cookieFor(db, userId, tpr);
    const working = await request(app).get('/api/v1/auth/me').set('Cookie', cashierCookie);
    expect(working.body.data.activeBranchId).toBe(tpr);

    await request(app)
      .put(`${BASE}/${userId}/branches`)
      .set('Cookie', cookie)
      .send({ branchIds: [cbe] })
      .expect(200);

    const after = await request(app).get('/api/v1/auth/me').set('Cookie', cashierCookie);
    expect(after.body.data).toMatchObject({ activeBranchId: null, needsBranchSelection: true });
    expect(after.body.data.branches.map((b: { code: string }) => b.code)).toEqual(['CBE']);
  });

  it('answers 404 for an unknown user, and 422 for a bad list', async () => {
    const { cookie } = await adminCookie();
    const missing = await request(app)
      .put(`${BASE}/99999/branches`)
      .set('Cookie', cookie)
      .send({ branchIds: [] });
    expect(missing.status).toBe(404);

    const userId = await createUser(pool, { username: 'ravi' });
    for (const branchIds of [[0], [-3], ['x'], 'all']) {
      const res = await request(app)
        .put(`${BASE}/${userId}/branches`)
        .set('Cookie', cookie)
        .send({ branchIds });
      expect(res.status).toBe(422);
    }
    expect(
      (await request(app).put(`${BASE}/${userId}/branches`).set('Cookie', cookie).send({})).status,
    ).toBe(422);
  });
});
