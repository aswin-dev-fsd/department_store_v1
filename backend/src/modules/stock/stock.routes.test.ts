// The stock read API (Task 3.6): current stock per item and one item's movement history. Writes
// to stock are tested with the ledger service (stock.service.test.ts); here stock is set up
// through that service, so the history under test is what a real bill or purchase would leave.
import { schema } from '@ds/database';
import { ADJUSTMENT_REASONS, MOVEMENT_REF_TYPES, MOVEMENT_TYPES } from '@ds/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import {
  cookieFor,
  createBranch,
  createCategory,
  createItem,
  createUser,
  mapUser,
  type ItemFixture,
} from '../../../test/helpers/fixtures.js';
import { seedOpeningStock } from '../../../test/helpers/ledger.js';
import { createApp } from '../../app.js';
import { postMovements, type MovementInput } from './stock.service.js';

const { db, pool } = createTestDb();
const app = createApp({ db });
const URL = '/api/v1/stock';

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

/** Post movements in their own transaction, as a bill or purchase service would. */
function post(branchId: number, userId: number, movements: MovementInput[]) {
  return db.transaction((tx) => postMovements(tx, { branchId, userId, movements }));
}

const purchase = (itemId: number, packs: number, refId = 1): MovementInput => ({
  itemId,
  quantity: packs,
  type: 'purchase',
  refType: 'purchase',
  refId,
});

const sale = (itemId: number, packs: number, refId = 1): MovementInput => ({
  itemId,
  quantity: -packs,
  type: 'sale',
  refType: 'bill',
  refId,
});

/** An item in the branch holding `quantity` packs (through an opening movement when above 0). */
async function itemWithStock(
  branchId: number,
  userId: number,
  quantity: number,
  options: ItemFixture = {},
): Promise<number> {
  const itemId = await createItem(pool, branchId, options);
  if (quantity > 0) await seedOpeningStock(pool, { branchId, itemId, userId, quantity });
  return itemId;
}

async function putInCategory(itemId: number, categoryId: number): Promise<void> {
  await pool.query('update items set category_id = $2 where id = $1', [itemId, categoryId]);
}

function namesIn(res: { body: { data: { items: { name: string }[] } } }): string[] {
  return res.body.data.items.map((line) => line.name);
}

describe('access control', () => {
  it.each([[URL], [`${URL}/1/movements`]])('GET %s answers 401 without a session', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
  });

  it('asks a cashier without a chosen branch to choose one (403 NO_ACTIVE_BRANCH) on both routes', async () => {
    const userId = await createUser(pool, { role: 'cashier' });
    const cookie = await cookieFor(db, userId, null);

    const responses = [
      await request(app).get(URL).set('Cookie', cookie),
      await request(app).get(`${URL}/1/movements`).set('Cookie', cookie),
    ];

    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('NO_ACTIVE_BRANCH');
    }
  });

  it('does not let a cashier without a chosen branch read a branch by naming it', async () => {
    const userId = await createUser(pool, { role: 'cashier' });
    const cookie = await cookieFor(db, userId, null);
    const branchId = await createBranch(pool);
    await createItem(pool, branchId, { name: 'Rice' });

    const res = await request(app).get(`${URL}?branchId=${branchId}`).set('Cookie', cookie);

    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
  });
});

describe('GET /stock', () => {
  it("lists the branch's items with their quantity, by name ignoring case, and never another branch's", async () => {
    const { userId, branchId, cookie } = await cashierIn();
    const other = await createBranch(pool);
    const rice = await itemWithStock(branchId, userId, 12, { code: 'R1', name: 'rice 10 kg' });
    const oil = await itemWithStock(branchId, userId, 0, { code: 'O1', name: 'Oil 1 l' });
    const soap = await itemWithStock(branchId, userId, 3, {
      code: 'S1',
      name: 'Soap',
      barcode: '8901',
    });
    await itemWithStock(other, userId, 9, { code: 'X1', name: 'Other branch item' });

    const res = await request(app).get(URL).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 3, limit: 20, offset: 0 });
    expect(res.body.data.items).toEqual([
      {
        itemId: oil,
        code: 'O1',
        barcode: null,
        name: 'Oil 1 l',
        categoryId: null,
        quantity: 0,
        reorderLevel: null,
        isActive: true,
      },
      {
        itemId: rice,
        code: 'R1',
        barcode: null,
        name: 'rice 10 kg',
        categoryId: null,
        quantity: 12,
        reorderLevel: null,
        isActive: true,
      },
      {
        itemId: soap,
        code: 'S1',
        barcode: '8901',
        name: 'Soap',
        categoryId: null,
        quantity: 3,
        reorderLevel: null,
        isActive: true,
      },
    ]);
  });

  it('shows the stock a movement left: the quantity follows the ledger', async () => {
    const { userId, branchId, cookie } = await cashierIn();
    const itemId = await createItem(pool, branchId, { name: 'Rice' });
    await post(branchId, userId, [purchase(itemId, 10)]);
    await post(branchId, userId, [sale(itemId, 4)]);

    const res = await request(app).get(URL).set('Cookie', cookie);

    expect(res.body.data.items).toMatchObject([{ itemId, quantity: 6 }]);
  });

  it('also lists deactivated items (marked isActive false) and items at zero', async () => {
    const { userId, branchId, cookie } = await cashierIn();
    const gone = await itemWithStock(branchId, userId, 5, {
      name: 'Discontinued',
      isActive: false,
    });
    const empty = await itemWithStock(branchId, userId, 0, { name: 'Sold out' });

    const res = await request(app).get(URL).set('Cookie', cookie);

    expect(res.body.data.total).toBe(2);
    expect(res.body.data.items).toMatchObject([
      { itemId: gone, name: 'Discontinued', quantity: 5, isActive: false },
      { itemId: empty, name: 'Sold out', quantity: 0, isActive: true },
    ]);
  });

  it('filters by category, and a category of another branch finds nothing', async () => {
    const { userId, branchId, cookie } = await cashierIn();
    const grocery = await createCategory(pool, branchId, 'Grocery');
    const foreign = await createCategory(pool, await createBranch(pool), 'Stationery');
    const rice = await itemWithStock(branchId, userId, 4, { name: 'Rice' });
    await itemWithStock(branchId, userId, 2, { name: 'Soap' });
    await putInCategory(rice, grocery);

    const mine = await request(app).get(`${URL}?categoryId=${grocery}`).set('Cookie', cookie);
    const theirs = await request(app).get(`${URL}?categoryId=${foreign}`).set('Cookie', cookie);

    expect(mine.body.data.total).toBe(1);
    expect(mine.body.data.items).toMatchObject([
      { itemId: rice, categoryId: grocery, quantity: 4 },
    ]);
    expect(theirs.body.data).toMatchObject({ total: 0, items: [] });
  });

  it('pages with limit and offset', async () => {
    const { branchId, cookie } = await cashierIn();
    for (const name of ['A', 'B', 'C', 'D', 'E']) await createItem(pool, branchId, { name });

    const res = await request(app).get(`${URL}?limit=2&offset=2`).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 5, limit: 2, offset: 2 });
    expect(namesIn(res)).toEqual(['C', 'D']);
  });

  it.each([
    ['limit=500'],
    ['limit=0'],
    ['offset=-1'],
    ['categoryId=abc'],
    ['categoryId=0'],
    ['branchId=abc'],
    ['branchId=0'],
  ])('refuses ?%s with 422', async (query) => {
    const { cookie } = await cashierIn();
    const res = await request(app).get(`${URL}?${query}`).set('Cookie', cookie);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lets a cashier name their own branch with ?branchId=, and refuses any other with 403 FORBIDDEN', async () => {
    const { branchId, cookie } = await cashierIn();
    const other = await createBranch(pool);
    await createItem(pool, other, { name: 'Other branch item' });

    const own = await request(app).get(`${URL}?branchId=${branchId}`).set('Cookie', cookie);
    const foreign = await request(app).get(`${URL}?branchId=${other}`).set('Cookie', cookie);
    const unknown = await request(app).get(`${URL}?branchId=999999`).set('Cookie', cookie);

    expect(own.status).toBe(200);
    for (const res of [foreign, unknown]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.data).toBeUndefined();
    }
  });

  it("shows a cashier only the branch they work in, even with another branch's items around", async () => {
    const a = await cashierIn();
    const b = await cashierIn();
    await createItem(pool, a.branchId, { name: 'Item in A' });
    await createItem(pool, b.branchId, { name: 'Item in B' });

    const seenByA = await request(app).get(URL).set('Cookie', a.cookie);
    const seenByB = await request(app).get(URL).set('Cookie', b.cookie);

    expect(namesIn(seenByA)).toEqual(['Item in A']);
    expect(namesIn(seenByB)).toEqual(['Item in B']);
  });
});

describe('GET /stock as the Admin', () => {
  it('reads the branch named with ?branchId=, whichever it is, and only that one', async () => {
    const a = await createBranch(pool);
    const b = await createBranch(pool);
    const userId = await createUser(pool);
    await itemWithStock(a, userId, 7, { name: 'Item in A' });
    await itemWithStock(b, userId, 2, { name: 'Item in B' });
    const cookie = await adminCookie();

    const readA = await request(app).get(`${URL}?branchId=${a}`).set('Cookie', cookie);
    const readB = await request(app).get(`${URL}?branchId=${b}`).set('Cookie', cookie);

    expect(readA.status).toBe(200);
    expect(readA.body.data.items).toMatchObject([{ name: 'Item in A', quantity: 7 }]);
    expect(readB.status).toBe(200);
    expect(readB.body.data.items).toMatchObject([{ name: 'Item in B', quantity: 2 }]);
  });

  it('filters and pages the named branch like a cashier does', async () => {
    const branchId = await createBranch(pool);
    const grocery = await createCategory(pool, branchId, 'Grocery');
    for (const name of ['A', 'B', 'C']) {
      await putInCategory(await createItem(pool, branchId, { name }), grocery);
    }
    await createItem(pool, branchId, { name: 'D, no category' });
    const cookie = await adminCookie();

    const res = await request(app)
      .get(`${URL}?branchId=${branchId}&categoryId=${grocery}&limit=2&offset=1`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 3, limit: 2, offset: 1 });
    expect(namesIn(res)).toEqual(['B', 'C']);
  });

  it('needs the branch: without ?branchId= it answers 422 on the branch', async () => {
    const res = await request(app)
      .get(URL)
      .set('Cookie', await adminCookie());

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      { path: 'query.branchId', message: expect.any(String) },
    ]);
  });

  it('answers 404 for a branch that does not exist', async () => {
    const res = await request(app)
      .get(`${URL}?branchId=999999`)
      .set('Cookie', await adminCookie());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('can read a deactivated branch', async () => {
    const branchId = await createBranch(pool, { isActive: false });
    await createItem(pool, branchId, { name: 'Left behind' });

    const res = await request(app)
      .get(`${URL}?branchId=${branchId}`)
      .set('Cookie', await adminCookie());

    expect(res.status).toBe(200);
    expect(namesIn(res)).toEqual(['Left behind']);
  });
});

describe('GET /stock/:itemId/movements', () => {
  it("returns the item's ledger newest first, with what moved, who moved it and when", async () => {
    const { branchId, cookie } = await cashierIn();
    const asha = await createUser(pool, { fullName: 'Asha Kumar' });
    const ravi = await createUser(pool, { fullName: 'Ravi S' });
    const itemId = await createItem(pool, branchId);
    await post(branchId, asha, [purchase(itemId, 10, 7)]);
    await post(branchId, asha, [sale(itemId, 3, 21)]);
    await post(branchId, ravi, [
      {
        itemId,
        quantity: -2,
        type: 'adjustment',
        refType: 'adjustment',
        refId: 4,
        reason: 'damage',
        note: 'Broken in the store room',
      },
    ]);

    const res = await request(app).get(`${URL}/${itemId}/movements`).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 3, limit: 20, offset: 0 });
    expect(res.body.data.items).toEqual([
      {
        id: expect.any(Number),
        type: 'adjustment',
        quantity: -2,
        balanceAfter: 5,
        refType: 'adjustment',
        refId: 4,
        reason: 'damage',
        note: 'Broken in the store room',
        createdBy: { id: ravi, fullName: 'Ravi S' },
        createdAt: expect.any(String),
      },
      {
        id: expect.any(Number),
        type: 'sale',
        quantity: -3,
        balanceAfter: 7,
        refType: 'bill',
        refId: 21,
        reason: null,
        note: null,
        createdBy: { id: asha, fullName: 'Asha Kumar' },
        createdAt: expect.any(String),
      },
      {
        id: expect.any(Number),
        type: 'purchase',
        quantity: 10,
        balanceAfter: 10,
        refType: 'purchase',
        refId: 7,
        reason: null,
        note: null,
        createdBy: { id: asha, fullName: 'Asha Kumar' },
        createdAt: expect.any(String),
      },
    ]);
    const { createdAt } = res.body.data.items[0];
    expect(new Date(createdAt).toISOString()).toBe(createdAt);
  });

  it('shows an opening movement from an import, which has no document behind it', async () => {
    const { userId, branchId, cookie } = await cashierIn();
    const itemId = await itemWithStock(branchId, userId, 12);

    const res = await request(app).get(`${URL}/${itemId}/movements`).set('Cookie', cookie);

    expect(res.body.data.items).toMatchObject([
      {
        type: 'opening',
        quantity: 12,
        balanceAfter: 12,
        refType: 'import',
        refId: null,
        reason: null,
        createdBy: { id: userId },
      },
    ]);
  });

  it('pages with limit and offset', async () => {
    const { userId, branchId, cookie } = await cashierIn();
    const itemId = await createItem(pool, branchId);
    await post(branchId, userId, [purchase(itemId, 10)]);
    await post(branchId, userId, [sale(itemId, 3)]);
    await post(branchId, userId, [sale(itemId, 2)]);

    const res = await request(app)
      .get(`${URL}/${itemId}/movements?limit=2&offset=1`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 3, limit: 2, offset: 1 });
    expect(res.body.data.items.map((m: { balanceAfter: number }) => m.balanceAfter)).toEqual([
      7, 10,
    ]);
  });

  it('orders by the ledger sequence, not by the clock: balance_after always follows the row below it', async () => {
    const { userId, branchId, cookie } = await cashierIn();
    const itemId = await createItem(pool, branchId);
    await post(branchId, userId, [purchase(itemId, 5)]);
    await post(branchId, userId, [sale(itemId, 1)]);
    await pool.query(
      `update stock_movements set created_at = now() + interval '1 hour'
        where item_id = $1 and type = 'purchase'`,
      [itemId],
    );

    const res = await request(app).get(`${URL}/${itemId}/movements`).set('Cookie', cookie);

    expect(res.body.data.items.map((m: { type: string }) => m.type)).toEqual(['sale', 'purchase']);
    expect(res.body.data.items.map((m: { balanceAfter: number }) => m.balanceAfter)).toEqual([
      4, 5,
    ]);
  });

  it("lists only that item's movements", async () => {
    const { userId, branchId, cookie } = await cashierIn();
    const rice = await createItem(pool, branchId, { name: 'Rice' });
    const soap = await createItem(pool, branchId, { name: 'Soap' });
    await post(branchId, userId, [purchase(rice, 10, 1), purchase(soap, 40, 1)]);
    await post(branchId, userId, [sale(soap, 5, 2)]);

    const res = await request(app).get(`${URL}/${rice}/movements`).set('Cookie', cookie);

    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items).toMatchObject([
      { type: 'purchase', quantity: 10, balanceAfter: 10 },
    ]);
  });

  it('answers an empty page for an item that has no movements yet', async () => {
    const { branchId, cookie } = await cashierIn();
    const itemId = await createItem(pool, branchId);

    const res = await request(app).get(`${URL}/${itemId}/movements`).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 0, items: [] });
  });

  it("answers 404 for another branch's item, even one with movements (branch isolation)", async () => {
    const mine = await cashierIn();
    const other = await createBranch(pool);
    const foreign = await itemWithStock(other, mine.userId, 8, { name: 'Other branch item' });

    const res = await request(app).get(`${URL}/${foreign}/movements`).set('Cookie', mine.cookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.data).toBeUndefined();
  });

  it('answers 404 for an item that does not exist', async () => {
    const { cookie } = await cashierIn();
    const res = await request(app).get(`${URL}/999999/movements`).set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it.each(['abc', '0', '1.5', '-1'])('refuses the item id %j with 422', async (itemId) => {
    const { cookie } = await cashierIn();
    const res = await request(app).get(`${URL}/${itemId}/movements`).set('Cookie', cookie);
    expect(res.status).toBe(422);
  });

  it.each([['limit=500'], ['limit=0'], ['offset=-1'], ['branchId=abc']])(
    'refuses ?%s with 422',
    async (query) => {
      const { branchId, cookie } = await cashierIn();
      const itemId = await createItem(pool, branchId);
      const res = await request(app)
        .get(`${URL}/${itemId}/movements?${query}`)
        .set('Cookie', cookie);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    },
  );

  it('lets a cashier name their own branch with ?branchId=, and refuses any other with 403 FORBIDDEN', async () => {
    const { userId, branchId, cookie } = await cashierIn();
    const other = await createBranch(pool);
    const itemId = await itemWithStock(branchId, userId, 3);

    const own = await request(app)
      .get(`${URL}/${itemId}/movements?branchId=${branchId}`)
      .set('Cookie', cookie);
    const foreign = await request(app)
      .get(`${URL}/${itemId}/movements?branchId=${other}`)
      .set('Cookie', cookie);

    expect(own.status).toBe(200);
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe('FORBIDDEN');
    expect(foreign.body.data).toBeUndefined();
  });
});

describe('GET /stock/:itemId/movements as the Admin', () => {
  it("reads an item's history with ?branchId=, in the branch the item belongs to and no other", async () => {
    const a = await createBranch(pool);
    const b = await createBranch(pool);
    const userId = await createUser(pool);
    const itemId = await createItem(pool, a);
    await post(a, userId, [purchase(itemId, 5)]);
    const cookie = await adminCookie();

    const right = await request(app)
      .get(`${URL}/${itemId}/movements?branchId=${a}`)
      .set('Cookie', cookie);
    const wrong = await request(app)
      .get(`${URL}/${itemId}/movements?branchId=${b}`)
      .set('Cookie', cookie);

    expect(right.status).toBe(200);
    expect(right.body.data).toMatchObject({ total: 1 });
    expect(right.body.data.items).toMatchObject([{ type: 'purchase', quantity: 5 }]);
    expect(wrong.status).toBe(404);
    expect(wrong.body.error.code).toBe('NOT_FOUND');
  });

  it('needs the branch: without ?branchId= it answers 422 on the branch', async () => {
    const branchId = await createBranch(pool);
    const itemId = await createItem(pool, branchId);

    const res = await request(app)
      .get(`${URL}/${itemId}/movements`)
      .set('Cookie', await adminCookie());

    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([
      { path: 'query.branchId', message: expect.any(String) },
    ]);
  });

  it('answers 404 for a branch that does not exist', async () => {
    const branchId = await createBranch(pool);
    const itemId = await createItem(pool, branchId);

    const res = await request(app)
      .get(`${URL}/${itemId}/movements?branchId=999999`)
      .set('Cookie', await adminCookie());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('the movement vocabularies', () => {
  it('are the same lists in @ds/shared as in the database enums', () => {
    expect([...MOVEMENT_TYPES]).toEqual(schema.movementType.enumValues);
    expect([...MOVEMENT_REF_TYPES]).toEqual(schema.movementRefType.enumValues);
    expect([...ADJUSTMENT_REASONS]).toEqual(schema.adjustmentReason.enumValues);
  });
});
