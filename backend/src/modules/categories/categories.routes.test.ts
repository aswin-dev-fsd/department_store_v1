import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { expectAudit } from '../../../test/helpers/audit.js';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import {
  cookieFor,
  createBranch,
  createCategory,
  createUser,
  mapUser,
} from '../../../test/helpers/fixtures.js';
import { createApp } from '../../app.js';

const { db, pool } = createTestDb();
const app = createApp({ db });
const URL = '/api/v1/categories';

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

async function names(branchId: number): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(
    'select name from categories where branch_id = $1 order by lower(name)',
    [branchId],
  );
  return rows.map((row) => row.name);
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

  it('refuses an Admin on every write with 403 FORBIDDEN, and changes nothing', async () => {
    const branchId = await createBranch(pool);
    const id = await createCategory(pool, branchId, 'Grocery');
    const cookie = await adminCookie();

    const created = await request(app).post(URL).set('Cookie', cookie).send({ name: 'Oils' });
    const renamed = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ name: 'Hacked' });

    expect(created.status).toBe(403);
    expect(created.body.error.code).toBe('FORBIDDEN');
    expect(renamed.status).toBe(403);
    expect(await names(branchId)).toEqual(['Grocery']);
  });

  it('gives an Admin no category list either: the v1 Admin works in no branch (403 NO_ACTIVE_BRANCH)', async () => {
    const res = await request(app)
      .get(URL)
      .set('Cookie', await adminCookie());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NO_ACTIVE_BRANCH');
  });

  it('asks a cashier without a chosen branch to choose one (403 NO_ACTIVE_BRANCH)', async () => {
    const userId = await createUser(pool, { role: 'cashier' });
    const cookie = await cookieFor(db, userId, null);

    const list = await request(app).get(URL).set('Cookie', cookie);
    const create = await request(app).post(URL).set('Cookie', cookie).send({ name: 'Oils' });

    expect(list.status).toBe(403);
    expect(list.body.error.code).toBe('NO_ACTIVE_BRANCH');
    expect(create.status).toBe(403);
    expect(create.body.error.code).toBe('NO_ACTIVE_BRANCH');
  });
});

describe('GET /categories', () => {
  it("lists the branch's categories by name, ignoring case, and never another branch's", async () => {
    const { branchId, cookie } = await cashierIn();
    const other = await createBranch(pool);
    await createCategory(pool, branchId, 'oils');
    await createCategory(pool, branchId, 'Beverages');
    await createCategory(pool, branchId, 'Grocery');
    await createCategory(pool, other, 'Stationery');

    const res = await request(app).get(URL).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.items.map((c: { name: string }) => c.name)).toEqual([
      'Beverages',
      'Grocery',
      'oils',
    ]);
    expect(res.body.data.items[0]).toEqual({
      id: expect.any(Number),
      name: 'Beverages',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('pages with limit and offset', async () => {
    const { branchId, cookie } = await cashierIn();
    for (const name of ['A', 'B', 'C', 'D', 'E']) await createCategory(pool, branchId, name);

    const res = await request(app).get(`${URL}?limit=2&offset=2`).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 5, limit: 2, offset: 2 });
    expect(res.body.data.items.map((c: { name: string }) => c.name)).toEqual(['C', 'D']);
  });

  it('refuses a bad limit with 422', async () => {
    const { cookie } = await cashierIn();
    const res = await request(app).get(`${URL}?limit=500`).set('Cookie', cookie);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /categories', () => {
  it('creates a category in the active branch (name trimmed) and audits it', async () => {
    const { userId, branchId, cookie } = await cashierIn();

    const res = await request(app).post(URL).set('Cookie', cookie).send({ name: '  Grocery ' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ id: expect.any(Number), name: 'Grocery' });
    expect(await names(branchId)).toEqual(['Grocery']);
    const audit = await expectAudit(db, {
      action: 'category.create',
      entity: 'category',
      entityId: res.body.data.id,
      actorId: userId,
    });
    expect(audit.branchId).toBe(branchId);
    expect(audit.after).toEqual({ name: 'Grocery' });
  });

  it('refuses a name already used in the branch, ignoring case and spaces: 400 DUPLICATE_NAME', async () => {
    const { branchId, cookie } = await cashierIn();
    await createCategory(pool, branchId, 'Grocery');

    for (const name of ['Grocery', 'grocery', '  GROCERY  ']) {
      const res = await request(app).post(URL).set('Cookie', cookie).send({ name });
      expect(res.status, name).toBe(400);
      expect(res.body.error.code).toBe('DUPLICATE_NAME');
    }
    expect(await names(branchId)).toEqual(['Grocery']);
  });

  it('allows the same name in another branch', async () => {
    const a = await cashierIn();
    const b = await cashierIn();
    await createCategory(pool, a.branchId, 'Grocery');

    const res = await request(app).post(URL).set('Cookie', b.cookie).send({ name: 'Grocery' });

    expect(res.status).toBe(201);
    expect(await names(b.branchId)).toEqual(['Grocery']);
  });

  it('answers one 201 and one 400 (never a 500) when two cashiers add the same name at once', async () => {
    const a = await cashierIn();
    const b = await cashierIn(a.branchId);

    const [first, second] = await Promise.all([
      request(app).post(URL).set('Cookie', a.cookie).send({ name: 'Oils' }),
      request(app).post(URL).set('Cookie', b.cookie).send({ name: 'oils' }),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 400]);
    expect((first.status === 400 ? first : second).body.error.code).toBe('DUPLICATE_NAME');
    expect((await names(a.branchId)).length).toBe(1);
  });

  it.each([
    ['blank', { name: '   ' }],
    ['missing', {}],
    ['too long', { name: 'x'.repeat(101) }],
  ])('refuses a %s name with 422', async (_label, body) => {
    const { branchId, cookie } = await cashierIn();
    const res = await request(app).post(URL).set('Cookie', cookie).send(body);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await names(branchId)).toEqual([]);
  });
});

describe('PATCH /categories/:id', () => {
  it('renames a category and audits the old and new name', async () => {
    const { userId, branchId, cookie } = await cashierIn();
    const id = await createCategory(pool, branchId, 'Grocry');

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ name: ' Grocery ' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id, name: 'Grocery' });
    expect(await names(branchId)).toEqual(['Grocery']);
    const audit = await expectAudit(db, {
      action: 'category.update',
      entity: 'category',
      entityId: id,
      actorId: userId,
    });
    expect(audit.branchId).toBe(branchId);
    expect(audit.before).toEqual({ name: 'Grocry' });
    expect(audit.after).toEqual({ name: 'Grocery' });
  });

  it('lets a category change only its capital letters', async () => {
    const { branchId, cookie } = await cashierIn();
    const id = await createCategory(pool, branchId, 'grocery');

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ name: 'Grocery' });

    expect(res.status).toBe(200);
    expect(await names(branchId)).toEqual(['Grocery']);
  });

  it('does nothing, and records nothing, when the name is unchanged', async () => {
    const { branchId, cookie } = await cashierIn();
    const id = await createCategory(pool, branchId, 'Grocery');

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ name: ' Grocery ' });

    expect(res.status).toBe(200);
    const { rows } = await pool.query(`select 1 from audit_logs where action = 'category.update'`);
    expect(rows).toHaveLength(0);
  });

  it('refuses a name another category in the branch already has: 400 DUPLICATE_NAME', async () => {
    const { branchId, cookie } = await cashierIn();
    await createCategory(pool, branchId, 'Grocery');
    const oils = await createCategory(pool, branchId, 'Oils');

    const res = await request(app)
      .patch(`${URL}/${oils}`)
      .set('Cookie', cookie)
      .send({ name: 'GROCERY' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DUPLICATE_NAME');
    expect(await names(branchId)).toEqual(['Grocery', 'Oils']);
  });

  it('allows a name that only another branch uses', async () => {
    const mine = await cashierIn();
    const other = await createBranch(pool);
    await createCategory(pool, other, 'Grocery');
    const id = await createCategory(pool, mine.branchId, 'Oils');

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', mine.cookie)
      .send({ name: 'Grocery' });

    expect(res.status).toBe(200);
  });

  it("answers 404 for another branch's category and changes nothing (branch isolation)", async () => {
    const a = await cashierIn();
    const other = await createBranch(pool);
    const foreign = await createCategory(pool, other, 'Stationery');

    const res = await request(app)
      .patch(`${URL}/${foreign}`)
      .set('Cookie', a.cookie)
      .send({ name: 'Hacked' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(await names(other)).toEqual(['Stationery']);
  });

  it('answers 404 for a category that does not exist', async () => {
    const { cookie } = await cashierIn();
    const res = await request(app).patch(`${URL}/999999`).set('Cookie', cookie).send({ name: 'x' });
    expect(res.status).toBe(404);
  });

  it.each(['abc', '0', '1.5'])('refuses the id %j with 422', async (id) => {
    const { cookie } = await cashierIn();
    const res = await request(app).patch(`${URL}/${id}`).set('Cookie', cookie).send({ name: 'x' });
    expect(res.status).toBe(422);
  });

  it('refuses a blank name with 422', async () => {
    const { branchId, cookie } = await cashierIn();
    const id = await createCategory(pool, branchId, 'Grocery');
    const res = await request(app).patch(`${URL}/${id}`).set('Cookie', cookie).send({ name: ' ' });
    expect(res.status).toBe(422);
    expect(await names(branchId)).toEqual(['Grocery']);
  });
});
