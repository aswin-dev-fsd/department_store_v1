import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectAudit } from '../../../test/helpers/audit.js';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import {
  cookieFor,
  createBranch,
  createCategory,
  createItem,
  createUser,
  mapUser,
} from '../../../test/helpers/fixtures.js';
import { movementCount, seedOpeningStock } from '../../../test/helpers/ledger.js';
import { createApp } from '../../app.js';

const { db, pool } = createTestDb();
const app = createApp({ db });
const URL = '/api/v1/items';

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

/** The body of a valid POST /items; override what a test is about. */
function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: 'RICE10',
    name: 'Rice 10 kg',
    mrpPaise: 65000,
    sellingPricePaise: 62000,
    ...overrides,
  };
}

interface Stored {
  id: number;
  code: string;
  barcode: string | null;
  name: string;
  categoryId: number | null;
  mrpPaise: number;
  sellingPricePaise: number;
  reorderLevel: number | null;
  isActive: boolean;
  stock: number | null;
}

/** The branch's items straight from the database, with the quantity of their item_stock row. */
async function stored(branchId: number): Promise<Stored[]> {
  const { rows } = await pool.query(
    `select i.id, i.code, i.barcode, i.name, i.category_id, i.mrp_paise, i.selling_price_paise,
            i.reorder_level, i.is_active, s.quantity
       from items i left join item_stock s on s.item_id = i.id
      where i.branch_id = $1 order by i.id`,
    [branchId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    code: row.code,
    barcode: row.barcode,
    name: row.name,
    categoryId: row.category_id === null ? null : Number(row.category_id),
    mrpPaise: Number(row.mrp_paise),
    sellingPricePaise: Number(row.selling_price_paise),
    reorderLevel: row.reorder_level,
    isActive: row.is_active,
    stock: row.quantity === null ? null : Number(row.quantity),
  }));
}

async function codesOf(branchId: number): Promise<string[]> {
  return (await stored(branchId)).map((item) => item.code);
}

async function putInCategory(itemId: number, categoryId: number): Promise<void> {
  await pool.query('update items set category_id = $2 where id = $1', [itemId, categoryId]);
}

async function auditCount(action: string): Promise<number> {
  const { rows } = await pool.query('select 1 from audit_logs where action = $1', [action]);
  return rows.length;
}

describe('access control', () => {
  it.each([
    ['GET', URL],
    ['GET', `${URL}/lookup?code=A`],
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
    const id = await createItem(pool, branchId, { code: 'A1', name: 'Soap' });
    const cookie = await adminCookie();

    const created = await request(app).post(URL).set('Cookie', cookie).send(body());
    const edited = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ name: 'Hacked' });

    expect(created.status).toBe(403);
    expect(created.body.error.code).toBe('FORBIDDEN');
    expect(edited.status).toBe(403);
    expect(edited.body.error.code).toBe('FORBIDDEN');
    expect((await stored(branchId)).map((item) => item.name)).toEqual(['Soap']);
  });

  it('gives an Admin no item list (the v1 Admin works in no branch: 403 NO_ACTIVE_BRANCH) and no lookup (403 FORBIDDEN: it does not bill)', async () => {
    const cookie = await adminCookie();

    const list = await request(app).get(URL).set('Cookie', cookie);
    const lookup = await request(app).get(`${URL}/lookup?code=A1`).set('Cookie', cookie);

    expect(list.status).toBe(403);
    expect(list.body.error.code).toBe('NO_ACTIVE_BRANCH');
    expect(lookup.status).toBe(403);
    expect(lookup.body.error.code).toBe('FORBIDDEN');
  });

  it('asks a cashier without a chosen branch to choose one (403 NO_ACTIVE_BRANCH) on every route', async () => {
    const userId = await createUser(pool, { role: 'cashier' });
    const cookie = await cookieFor(db, userId, null);

    const responses = [
      await request(app).get(URL).set('Cookie', cookie),
      await request(app).get(`${URL}/lookup?code=A1`).set('Cookie', cookie),
      await request(app).post(URL).set('Cookie', cookie).send(body()),
      await request(app).patch(`${URL}/1`).set('Cookie', cookie).send({ name: 'x' }),
    ];

    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('NO_ACTIVE_BRANCH');
    }
  });
});

describe('POST /items', () => {
  it('creates the item in the active branch with its stock row at 0, and audits it', async () => {
    const { userId, branchId, cookie } = await cashierIn();
    const categoryId = await createCategory(pool, branchId, 'Grocery');

    const res = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send(
        body({
          code: '  RICE10 ',
          name: ' Rice 10 kg ',
          barcode: ' 8901234567890 ',
          categoryId,
          reorderLevel: 4,
        }),
      );

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      id: expect.any(Number),
      code: 'RICE10',
      barcode: '8901234567890',
      name: 'Rice 10 kg',
      categoryId,
      mrpPaise: 65000,
      sellingPricePaise: 62000,
      reorderLevel: 4,
      isActive: true,
      stock: 0,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(await stored(branchId)).toEqual([
      {
        id: res.body.data.id,
        code: 'RICE10',
        barcode: '8901234567890',
        name: 'Rice 10 kg',
        categoryId,
        mrpPaise: 65000,
        sellingPricePaise: 62000,
        reorderLevel: 4,
        isActive: true,
        stock: 0,
      },
    ]);
    const audit = await expectAudit(db, {
      action: 'item.create',
      entity: 'item',
      entityId: res.body.data.id,
      actorId: userId,
    });
    expect(audit.branchId).toBe(branchId);
    expect(audit.after).toEqual({
      code: 'RICE10',
      barcode: '8901234567890',
      name: 'Rice 10 kg',
      categoryId,
      mrpPaise: 65000,
      sellingPricePaise: 62000,
      reorderLevel: 4,
      isActive: true,
    });
  });

  it('needs only the code, name and prices: the rest start empty', async () => {
    const { branchId, cookie } = await cashierIn();

    const res = await request(app).post(URL).set('Cookie', cookie).send(body());

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ barcode: null, categoryId: null, reorderLevel: null });
    expect(await codesOf(branchId)).toEqual(['RICE10']);
  });

  it('creates the item and its stock row together: if the stock row cannot be written, no item is left', async () => {
    const { branchId, cookie } = await cashierIn();
    const model = await import('./items.model.js');
    const failing = vi
      .spyOn(model, 'insertStockRow')
      .mockRejectedValueOnce(new Error('stock row failed'));

    let status: number;
    try {
      status = (await request(app).post(URL).set('Cookie', cookie).send(body())).status;
    } finally {
      failing.mockRestore();
    }

    expect(status).toBe(500);
    expect(await stored(branchId)).toEqual([]);
    expect(await auditCount('item.create')).toBe(0);
  });

  it('keeps the price as whole paise, never as rupees or a fraction', async () => {
    const { cookie } = await cashierIn();

    const res = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send(body({ mrpPaise: 12345, sellingPricePaise: 12300 }));

    expect(res.status).toBe(201);
    expect(res.body.data.mrpPaise).toBe(12345);
    expect(res.body.data.sellingPricePaise).toBe(12300);
  });

  it('refuses a code the branch already uses: 400 DUPLICATE_CODE', async () => {
    const { branchId, cookie } = await cashierIn();
    await createItem(pool, branchId, { code: 'RICE10' });

    const res = await request(app).post(URL).set('Cookie', cookie).send(body());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DUPLICATE_CODE');
    expect(await codesOf(branchId)).toEqual(['RICE10']);
    expect(await auditCount('item.create')).toBe(0);
  });

  it('refuses a barcode the branch already uses: 400 DUPLICATE_BARCODE', async () => {
    const { branchId, cookie } = await cashierIn();
    await createItem(pool, branchId, { code: 'OTHER', barcode: '8901' });

    const res = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send(body({ barcode: '8901' }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DUPLICATE_BARCODE');
    expect(await codesOf(branchId)).toEqual(['OTHER']);
  });

  it('allows the same code and the same barcode in another branch', async () => {
    const a = await cashierIn();
    const b = await cashierIn();
    await createItem(pool, a.branchId, { code: 'RICE10', barcode: '8901' });

    const res = await request(app)
      .post(URL)
      .set('Cookie', b.cookie)
      .send(body({ barcode: '8901' }));

    expect(res.status).toBe(201);
    expect(await codesOf(b.branchId)).toEqual(['RICE10']);
  });

  it('allows any number of items without a barcode, and treats a blank barcode as none', async () => {
    const { branchId, cookie } = await cashierIn();

    const first = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send(body({ code: 'A' }));
    const second = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send(body({ code: 'B', barcode: '  ' }));
    const third = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send(body({ code: 'C', barcode: '' }));

    expect([first.status, second.status, third.status]).toEqual([201, 201, 201]);
    expect((await stored(branchId)).map((item) => item.barcode)).toEqual([null, null, null]);
  });

  it('answers one 201 and one 400 DUPLICATE_CODE (never a 500) when two cashiers add the same code at once', async () => {
    const a = await cashierIn();
    const b = await cashierIn(a.branchId);

    const [first, second] = await Promise.all([
      request(app)
        .post(URL)
        .set('Cookie', a.cookie)
        .send(body({ name: 'From A' })),
      request(app)
        .post(URL)
        .set('Cookie', b.cookie)
        .send(body({ name: 'From B' })),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 400]);
    expect((first.status === 400 ? first : second).body.error.code).toBe('DUPLICATE_CODE');
    const items = await stored(a.branchId);
    expect(items).toHaveLength(1);
    expect(items[0]!.stock).toBe(0);
  });

  it('answers one 201 and one 400 DUPLICATE_BARCODE when two cashiers add the same barcode at once', async () => {
    const a = await cashierIn();
    const b = await cashierIn(a.branchId);

    const [first, second] = await Promise.all([
      request(app)
        .post(URL)
        .set('Cookie', a.cookie)
        .send(body({ code: 'A', barcode: '8901' })),
      request(app)
        .post(URL)
        .set('Cookie', b.cookie)
        .send(body({ code: 'B', barcode: '8901' })),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 400]);
    expect((first.status === 400 ? first : second).body.error.code).toBe('DUPLICATE_BARCODE');
    expect(await stored(a.branchId)).toHaveLength(1);
  });

  it('refuses a selling price above the MRP with 422, on the selling price, and creates nothing', async () => {
    const { branchId, cookie } = await cashierIn();

    const res = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send(body({ mrpPaise: 10000, sellingPricePaise: 10001 }));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      { path: 'body.sellingPricePaise', message: expect.any(String) },
    ]);
    expect(await stored(branchId)).toEqual([]);
  });

  it('allows a selling price equal to the MRP', async () => {
    const { cookie } = await cashierIn();
    const res = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send(body({ mrpPaise: 10000, sellingPricePaise: 10000 }));
    expect(res.status).toBe(201);
  });

  it.each([
    ['no code', { code: undefined }],
    ['a blank code', { code: '  ' }],
    ['no name', { name: undefined }],
    ['a name over 100 characters', { name: 'n'.repeat(101) }],
    ['no MRP', { mrpPaise: undefined }],
    ['no selling price', { sellingPricePaise: undefined }],
    ['a fractional price', { mrpPaise: 100.5 }],
    ['a price in text', { sellingPricePaise: '620' }],
    ['a negative price', { sellingPricePaise: -1 }],
    ['a negative reorder level', { reorderLevel: -1 }],
    ['a category id of 0', { categoryId: 0 }],
  ])('refuses %s with 422', async (_label, overrides) => {
    const { branchId, cookie } = await cashierIn();
    const res = await request(app).post(URL).set('Cookie', cookie).send(body(overrides));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await stored(branchId)).toEqual([]);
  });

  it('refuses a category that does not exist, or belongs to another branch, with 422 on the category', async () => {
    const { branchId, cookie } = await cashierIn();
    const foreign = await createCategory(pool, await createBranch(pool), 'Stationery');

    for (const categoryId of [foreign, 999999]) {
      const res = await request(app).post(URL).set('Cookie', cookie).send(body({ categoryId }));
      expect(res.status, String(categoryId)).toBe(422);
      expect(res.body.error.details).toEqual([
        { path: 'body.categoryId', message: expect.any(String) },
      ]);
    }
    expect(await stored(branchId)).toEqual([]);
  });
});

describe('PATCH /items/:id', () => {
  it('edits the fields it is given and audits the old and new values', async () => {
    const { userId, branchId, cookie } = await cashierIn();
    const categoryId = await createCategory(pool, branchId, 'Grocery');
    const id = await createItem(pool, branchId, { code: 'R1', name: 'Rise 10 kg' });

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ name: ' Rice 10 kg ', categoryId, barcode: '8901', reorderLevel: 3 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id,
      code: 'R1',
      name: 'Rice 10 kg',
      categoryId,
      barcode: '8901',
      reorderLevel: 3,
    });
    expect(await stored(branchId)).toMatchObject([
      { id, name: 'Rice 10 kg', categoryId, barcode: '8901', reorderLevel: 3 },
    ]);
    const audit = await expectAudit(db, {
      action: 'item.update',
      entity: 'item',
      entityId: id,
      actorId: userId,
    });
    expect(audit.branchId).toBe(branchId);
    expect(audit.before).toEqual({
      name: 'Rise 10 kg',
      categoryId: null,
      barcode: null,
      reorderLevel: null,
    });
    expect(audit.after).toEqual({
      name: 'Rice 10 kg',
      categoryId,
      barcode: '8901',
      reorderLevel: 3,
    });
  });

  it('records a price change with the old and the new price, and only the prices that changed', async () => {
    const { userId, branchId, cookie } = await cashierIn();
    const id = await createItem(pool, branchId, { mrpPaise: 65000, sellingPricePaise: 62000 });

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ mrpPaise: 65000, sellingPricePaise: 60000 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ mrpPaise: 65000, sellingPricePaise: 60000 });
    const audit = await expectAudit(db, { action: 'item.update', entityId: id, actorId: userId });
    expect(audit.before).toEqual({ sellingPricePaise: 62000 });
    expect(audit.after).toEqual({ sellingPricePaise: 60000 });
  });

  it('lets both prices move together', async () => {
    const { branchId, cookie } = await cashierIn();
    const id = await createItem(pool, branchId, { mrpPaise: 65000, sellingPricePaise: 62000 });

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ mrpPaise: 50000, sellingPricePaise: 45000 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ mrpPaise: 50000, sellingPricePaise: 45000 });
  });

  it('refuses a selling price above the current MRP: 422 on the selling price, nothing changed', async () => {
    const { branchId, cookie } = await cashierIn();
    const id = await createItem(pool, branchId, { mrpPaise: 65000, sellingPricePaise: 62000 });

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ sellingPricePaise: 65001 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      { path: 'body.sellingPricePaise', message: expect.any(String) },
    ]);
    expect(await stored(branchId)).toMatchObject([{ mrpPaise: 65000, sellingPricePaise: 62000 }]);
    expect(await auditCount('item.update')).toBe(0);
  });

  it('refuses an MRP below the current selling price: 422 on the MRP, nothing changed', async () => {
    const { branchId, cookie } = await cashierIn();
    const id = await createItem(pool, branchId, { mrpPaise: 65000, sellingPricePaise: 62000 });

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ mrpPaise: 61999 });

    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([
      { path: 'body.mrpPaise', message: expect.any(String) },
    ]);
    expect(await stored(branchId)).toMatchObject([{ mrpPaise: 65000, sellingPricePaise: 62000 }]);
  });

  it('does nothing, and records nothing, when no field really changes', async () => {
    const { branchId, cookie } = await cashierIn();
    const id = await createItem(pool, branchId, { code: 'R1', name: 'Rice' });

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ name: ' Rice ', code: 'R1' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id, name: 'Rice' });
    expect(await auditCount('item.update')).toBe(0);
  });

  it('deactivates an item, then reactivates it, auditing each and keeping its stock', async () => {
    const { userId, branchId, cookie } = await cashierIn();
    const id = await createItem(pool, branchId);
    await seedOpeningStock(pool, { branchId, itemId: id, userId, quantity: 7 });

    const off = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ isActive: false });

    expect(off.status).toBe(200);
    expect(off.body.data).toMatchObject({ isActive: false, stock: 7 });
    const deactivated = await expectAudit(db, { action: 'item.deactivate', entityId: id });
    expect(deactivated.before).toEqual({ isActive: true });
    expect(deactivated.after).toEqual({ isActive: false });

    const on = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ isActive: true });

    expect(on.status).toBe(200);
    expect(on.body.data.isActive).toBe(true);
    await expectAudit(db, { action: 'item.activate', entityId: id });
  });

  it('clears the barcode, the category and the reorder level with null', async () => {
    const { branchId, cookie } = await cashierIn();
    const categoryId = await createCategory(pool, branchId, 'Grocery');
    const id = await createItem(pool, branchId, { barcode: '8901' });
    await putInCategory(id, categoryId);
    await pool.query('update items set reorder_level = 5 where id = $1', [id]);

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ barcode: null, categoryId: null, reorderLevel: null });

    expect(res.status).toBe(200);
    expect(await stored(branchId)).toMatchObject([
      { barcode: null, categoryId: null, reorderLevel: null },
    ]);
  });

  it("never changes the item's stock or ledger", async () => {
    const { userId, branchId, cookie } = await cashierIn();
    const id = await createItem(pool, branchId);
    await seedOpeningStock(pool, { branchId, itemId: id, userId, quantity: 5 });

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ name: 'Renamed', sellingPricePaise: 100, mrpPaise: 200 });

    expect(res.status).toBe(200);
    expect(res.body.data.stock).toBe(5);
    expect(await movementCount(pool, id)).toBe(1);
  });

  it('refuses a code another item of the branch has: 400 DUPLICATE_CODE', async () => {
    const { branchId, cookie } = await cashierIn();
    await createItem(pool, branchId, { code: 'A1' });
    const second = await createItem(pool, branchId, { code: 'B1' });

    const res = await request(app)
      .patch(`${URL}/${second}`)
      .set('Cookie', cookie)
      .send({ code: 'A1' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DUPLICATE_CODE');
    expect(await codesOf(branchId)).toEqual(['A1', 'B1']);
  });

  it('refuses a barcode another item of the branch has: 400 DUPLICATE_BARCODE', async () => {
    const { branchId, cookie } = await cashierIn();
    await createItem(pool, branchId, { code: 'A1', barcode: '8901' });
    const second = await createItem(pool, branchId, { code: 'B1' });

    const res = await request(app)
      .patch(`${URL}/${second}`)
      .set('Cookie', cookie)
      .send({ barcode: '8901' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DUPLICATE_BARCODE');
    expect((await stored(branchId)).map((item) => item.barcode)).toEqual(['8901', null]);
  });

  it('allows a code or barcode that only another branch uses', async () => {
    const mine = await cashierIn();
    const other = await createBranch(pool);
    await createItem(pool, other, { code: 'A1', barcode: '8901' });
    const id = await createItem(pool, mine.branchId, { code: 'B1' });

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', mine.cookie)
      .send({ code: 'A1', barcode: '8901' });

    expect(res.status).toBe(200);
  });

  it("answers 404 for another branch's item and changes nothing (branch isolation)", async () => {
    const a = await cashierIn();
    const other = await createBranch(pool);
    const foreign = await createItem(pool, other, { name: 'Soap' });

    const res = await request(app)
      .patch(`${URL}/${foreign}`)
      .set('Cookie', a.cookie)
      .send({ name: 'Hacked', isActive: false });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(await stored(other)).toMatchObject([{ name: 'Soap', isActive: true }]);
  });

  it('answers 404 for an item that does not exist', async () => {
    const { cookie } = await cashierIn();
    const res = await request(app).patch(`${URL}/999999`).set('Cookie', cookie).send({ name: 'x' });
    expect(res.status).toBe(404);
  });

  it('refuses a category of another branch with 422 on the category, and changes nothing', async () => {
    const { branchId, cookie } = await cashierIn();
    const id = await createItem(pool, branchId);
    const foreign = await createCategory(pool, await createBranch(pool), 'Stationery');

    const res = await request(app)
      .patch(`${URL}/${id}`)
      .set('Cookie', cookie)
      .send({ categoryId: foreign });

    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([
      { path: 'body.categoryId', message: expect.any(String) },
    ]);
    expect(await stored(branchId)).toMatchObject([{ categoryId: null }]);
  });

  it.each(['abc', '0', '1.5'])('refuses the id %j with 422', async (id) => {
    const { cookie } = await cashierIn();
    const res = await request(app).patch(`${URL}/${id}`).set('Cookie', cookie).send({ name: 'x' });
    expect(res.status).toBe(422);
  });

  it.each([
    ['an empty body', {}],
    ['a blank name', { name: ' ' }],
    ['a fractional price', { sellingPricePaise: 10.5 }],
    ['a negative MRP', { mrpPaise: -5 }],
  ])('refuses %s with 422 and changes nothing', async (_label, patch) => {
    const { branchId, cookie } = await cashierIn();
    const id = await createItem(pool, branchId, { name: 'Soap' });
    const res = await request(app).patch(`${URL}/${id}`).set('Cookie', cookie).send(patch);
    expect(res.status).toBe(422);
    expect(await stored(branchId)).toMatchObject([{ name: 'Soap' }]);
  });
});

describe('GET /items', () => {
  it("lists the branch's items by name, ignoring case, with their stock, and never another branch's", async () => {
    const { userId, branchId, cookie } = await cashierIn();
    const other = await createBranch(pool);
    await createItem(pool, branchId, { code: 'C', name: 'sugar 1 kg' });
    const rice = await createItem(pool, branchId, { code: 'A', name: 'Rice 10 kg' });
    await createItem(pool, branchId, { code: 'B', name: 'Oil 1 l' });
    await createItem(pool, other, { code: 'D', name: 'Soap' });
    await seedOpeningStock(pool, { branchId, itemId: rice, userId, quantity: 12 });

    const res = await request(app).get(URL).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.items.map((item: { name: string }) => item.name)).toEqual([
      'Oil 1 l',
      'Rice 10 kg',
      'sugar 1 kg',
    ]);
    expect(res.body.data.items[1]).toEqual({
      id: rice,
      code: 'A',
      barcode: null,
      name: 'Rice 10 kg',
      categoryId: null,
      mrpPaise: 10000,
      sellingPricePaise: 9000,
      reorderLevel: null,
      isActive: true,
      stock: 12,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(res.body.data.items[0].stock).toBe(0);
  });

  it('searches the name, the code and the barcode, in any case, by any part', async () => {
    const { branchId, cookie } = await cashierIn();
    await createItem(pool, branchId, { code: 'X1', name: 'Basmati RICE 5 kg' });
    await createItem(pool, branchId, { code: 'RICE-OLD', name: 'Old stock' });
    await createItem(pool, branchId, { code: 'X3', name: 'Idli batter', barcode: '8901rice77' });
    await createItem(pool, branchId, { code: 'X4', name: 'Sugar' });

    const res = await request(app).get(`${URL}?search=rice`).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.items.map((item: { code: string }) => item.code).sort()).toEqual([
      'RICE-OLD',
      'X1',
      'X3',
    ]);
  });

  it('treats % and _ in the search as plain characters, not wildcards', async () => {
    const { branchId, cookie } = await cashierIn();
    await createItem(pool, branchId, { code: 'P1', name: '100% juice' });
    await createItem(pool, branchId, { code: 'P2', name: 'Plain water' });
    await createItem(pool, branchId, { code: 'P3', name: 'A_B cable' });

    const percent = await request(app)
      .get(`${URL}?search=${encodeURIComponent('%')}`)
      .set('Cookie', cookie);
    const underscore = await request(app).get(`${URL}?search=_`).set('Cookie', cookie);

    expect(percent.body.data.items.map((item: { code: string }) => item.code)).toEqual(['P1']);
    expect(underscore.body.data.items.map((item: { code: string }) => item.code)).toEqual(['P3']);
  });

  it('searches only the active branch', async () => {
    const { cookie } = await cashierIn();
    const other = await createBranch(pool);
    await createItem(pool, other, { code: 'R1', name: 'Rice' });

    const res = await request(app).get(`${URL}?search=rice`).set('Cookie', cookie);

    expect(res.body.data).toMatchObject({ total: 0, items: [] });
  });

  it('filters by category, and a category of another branch finds nothing', async () => {
    const { branchId, cookie } = await cashierIn();
    const grocery = await createCategory(pool, branchId, 'Grocery');
    const foreign = await createCategory(pool, await createBranch(pool), 'Stationery');
    const rice = await createItem(pool, branchId, { code: 'R1', name: 'Rice' });
    await createItem(pool, branchId, { code: 'S1', name: 'Soap' });
    await putInCategory(rice, grocery);

    const mine = await request(app).get(`${URL}?categoryId=${grocery}`).set('Cookie', cookie);
    const theirs = await request(app).get(`${URL}?categoryId=${foreign}`).set('Cookie', cookie);

    expect(mine.body.data.items.map((item: { code: string }) => item.code)).toEqual(['R1']);
    expect(theirs.body.data).toMatchObject({ total: 0, items: [] });
  });

  it('combines the search and the category filter', async () => {
    const { branchId, cookie } = await cashierIn();
    const grocery = await createCategory(pool, branchId, 'Grocery');
    const a = await createItem(pool, branchId, { code: 'A', name: 'Rice' });
    const b = await createItem(pool, branchId, { code: 'B', name: 'Rice bran oil' });
    await createItem(pool, branchId, { code: 'C', name: 'Rice cooker' });
    await putInCategory(a, grocery);
    await putInCategory(b, grocery);

    const res = await request(app)
      .get(`${URL}?search=bran&categoryId=${grocery}`)
      .set('Cookie', cookie);

    expect(res.body.data.items.map((item: { code: string }) => item.code)).toEqual(['B']);
  });

  it('shows deactivated items only when asked: active=false lists them, active=true hides them, no filter shows both', async () => {
    const { branchId, cookie } = await cashierIn();
    await createItem(pool, branchId, { code: 'ON', name: 'Rice' });
    await createItem(pool, branchId, { code: 'OFF', name: 'Rice old', isActive: false });

    const inactive = await request(app)
      .get(`${URL}?active=false&search=rice`)
      .set('Cookie', cookie);
    const active = await request(app).get(`${URL}?active=true&search=rice`).set('Cookie', cookie);
    const both = await request(app).get(`${URL}?search=rice`).set('Cookie', cookie);

    expect(inactive.body.data.items.map((item: { code: string }) => item.code)).toEqual(['OFF']);
    expect(active.body.data.items.map((item: { code: string }) => item.code)).toEqual(['ON']);
    expect(both.body.data.total).toBe(2);
  });

  it('pages with limit and offset', async () => {
    const { branchId, cookie } = await cashierIn();
    for (const name of ['A', 'B', 'C', 'D', 'E']) await createItem(pool, branchId, { name });

    const res = await request(app).get(`${URL}?limit=2&offset=2`).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 5, limit: 2, offset: 2 });
    expect(res.body.data.items.map((item: { name: string }) => item.name)).toEqual(['C', 'D']);
  });

  it.each([
    ['limit=500'],
    ['categoryId=abc'],
    ['categoryId=0'],
    ['active=maybe'],
    [`search=${'s'.repeat(101)}`],
  ])('refuses ?%s with 422', async (query) => {
    const { cookie } = await cashierIn();
    const res = await request(app).get(`${URL}?${query}`).set('Cookie', cookie);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /items/lookup', () => {
  it('finds an active item by its exact barcode, with its stock', async () => {
    const { userId, branchId, cookie } = await cashierIn();
    const id = await createItem(pool, branchId, { code: 'R1', name: 'Rice', barcode: '8901234' });
    await seedOpeningStock(pool, { branchId, itemId: id, userId, quantity: 9 });

    const res = await request(app).get(`${URL}/lookup?barcode=8901234`).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id,
      code: 'R1',
      name: 'Rice',
      barcode: '8901234',
      mrpPaise: 10000,
      sellingPricePaise: 9000,
      stock: 9,
    });
  });

  it('finds an active item by its exact code', async () => {
    const { branchId, cookie } = await cashierIn();
    const id = await createItem(pool, branchId, { code: 'R1', name: 'Rice' });

    const res = await request(app).get(`${URL}/lookup?code=R1`).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id, code: 'R1', stock: 0 });
  });

  it('matches the whole barcode or code only: a part of it finds nothing', async () => {
    const { branchId, cookie } = await cashierIn();
    await createItem(pool, branchId, { code: 'RICE10', barcode: '8901234' });

    const barcode = await request(app).get(`${URL}/lookup?barcode=8901`).set('Cookie', cookie);
    const code = await request(app).get(`${URL}/lookup?code=RICE`).set('Cookie', cookie);

    expect(barcode.status).toBe(404);
    expect(code.status).toBe(404);
  });

  it('answers 404 NOT_FOUND when nothing matches', async () => {
    const { cookie } = await cashierIn();
    const res = await request(app).get(`${URL}/lookup?barcode=000`).set('Cookie', cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers 404 for a deactivated item, which search still finds with active=false', async () => {
    const { branchId, cookie } = await cashierIn();
    const id = await createItem(pool, branchId, { code: 'R1', barcode: '8901', isActive: false });

    const byBarcode = await request(app).get(`${URL}/lookup?barcode=8901`).set('Cookie', cookie);
    const byCode = await request(app).get(`${URL}/lookup?code=R1`).set('Cookie', cookie);
    const search = await request(app).get(`${URL}?active=false&search=R1`).set('Cookie', cookie);

    expect(byBarcode.status).toBe(404);
    expect(byCode.status).toBe(404);
    expect(search.body.data.items.map((item: { id: number }) => item.id)).toEqual([id]);
  });

  it("answers 404 for another branch's barcode or code (branch isolation)", async () => {
    const { cookie } = await cashierIn();
    const other = await createBranch(pool);
    await createItem(pool, other, { code: 'R1', barcode: '8901' });

    const byBarcode = await request(app).get(`${URL}/lookup?barcode=8901`).set('Cookie', cookie);
    const byCode = await request(app).get(`${URL}/lookup?code=R1`).set('Cookie', cookie);

    expect(byBarcode.status).toBe(404);
    expect(byCode.status).toBe(404);
  });

  it.each([
    ['neither', ''],
    ['a blank barcode', '?barcode=%20'],
    ['both', '?barcode=8901&code=R1'],
  ])('refuses %s with 422', async (_label, query) => {
    const { cookie } = await cashierIn();
    const res = await request(app).get(`${URL}/lookup${query}`).set('Cookie', cookie);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
