// Stock adjustments (Task 6.1; D-20): a correction with a reason, through the ledger, audited.
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
  movementCount,
  seedOpeningStock,
  stockOf,
} from '../../../test/helpers/ledger.js';
import { createApp } from '../../app.js';

const { db, pool } = createTestDb();
const app = createApp({ db });
const URL = '/api/v1/stock/adjustments';

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
  /** An item with 10 packs. */
  itemId: number;
}

/** A cashier at a new branch with one item of 10 packs. */
async function counter(): Promise<Counter> {
  const branchId = await createBranch(pool);
  const userId = await createUser(pool, { role: 'cashier' });
  await mapUser(pool, userId, branchId);
  const itemId = await createItem(pool, branchId, { code: 'R10' });
  await seedOpeningStock(pool, { branchId, itemId, userId, quantity: 10 });
  return { userId, branchId, cookie: await cookieFor(db, userId, branchId), itemId };
}

function adjust(cookie: string, body: object) {
  return request(app).post(URL).set('Cookie', cookie).send(body);
}

/** The item's ledger rows, oldest first. */
async function movements(itemId: number) {
  const { rows } = await pool.query(
    `select type, quantity, balance_after, ref_type, ref_id, reason, note, created_by
       from stock_movements where item_id = $1 order by id`,
    [itemId],
  );
  return rows;
}

describe('POST /stock/adjustments', () => {
  it('takes stock down with a reason: one adjustment movement, the stock changed, audited', async () => {
    const c = await counter();

    const res = await adjust(c.cookie, { itemId: c.itemId, quantity: -2, reason: 'damage' });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toEqual({
      itemId: c.itemId,
      quantity: -2,
      reason: 'damage',
      note: null,
      balanceBefore: 10,
      balanceAfter: 8,
    });
    expect(await stockOf(pool, c.itemId)).toBe(8);
    expect((await movements(c.itemId)).at(-1)).toMatchObject({
      type: 'adjustment',
      quantity: -2,
      balance_after: 8,
      ref_type: 'adjustment',
      ref_id: null,
      reason: 'damage',
      note: null,
      created_by: c.userId,
    });
    await assertLedgerMatchesStock(pool, c.itemId);

    const audit = await expectAudit(db, {
      action: 'stock.adjust',
      entity: 'item',
      entityId: c.itemId,
      actorId: c.userId,
    });
    expect(audit.branchId).toBe(c.branchId);
    expect(audit.before).toEqual({ stock: 10 });
    expect(audit.after).toEqual({ stock: 8, change: -2, reason: 'damage', note: null });
  });

  it('adds stock for a count correction, and keeps the note', async () => {
    const c = await counter();

    const res = await adjust(c.cookie, {
      itemId: c.itemId,
      quantity: 3,
      reason: 'count_correction',
      note: 'Found behind the shelf',
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ balanceBefore: 10, balanceAfter: 13 });
    expect((await movements(c.itemId)).at(-1)).toMatchObject({
      quantity: 3,
      reason: 'count_correction',
      note: 'Found behind the shelf',
    });
    await assertLedgerMatchesStock(pool, c.itemId);
  });

  it('accepts "other" with a note, and refuses it without one (422 on note, nothing saved)', async () => {
    const c = await counter();

    const missing = await adjust(c.cookie, { itemId: c.itemId, quantity: -1, reason: 'other' });
    expect(missing.status).toBe(422);
    expect(missing.body.error.details).toEqual([
      { path: 'body.note', message: 'Describe the reason in a note' },
    ]);
    expect(await movementCount(pool, c.itemId)).toBe(1);

    const given = await adjust(c.cookie, {
      itemId: c.itemId,
      quantity: -1,
      reason: 'other',
      note: 'Given as a sample',
    });
    expect(given.status).toBe(201);
    expect(await stockOf(pool, c.itemId)).toBe(9);
  });

  it.each([
    ['a quantity of 0', { quantity: 0 }, 'body.quantity'],
    ['a part pack', { quantity: 1.5 }, 'body.quantity'],
    ['a quantity as text', { quantity: '-2' }, 'body.quantity'],
    ['an unknown reason', { reason: 'gift' }, 'body.reason'],
    ['a missing reason', { reason: undefined }, 'body.reason'],
    ['a field it does not know', { balanceAfter: 99 }, 'body'],
  ])('refuses %s with 422 and saves nothing', async (_label, change, path) => {
    const c = await counter();
    const res = await adjust(c.cookie, {
      itemId: c.itemId,
      quantity: -2,
      reason: 'damage',
      ...change,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((detail: { path: string }) => detail.path)).toContain(path);
    expect(await stockOf(pool, c.itemId)).toBe(10);
    expect(await movementCount(pool, c.itemId)).toBe(1);
  });

  it('refuses to take stock below zero: 400 INSUFFICIENT_STOCK, nothing saved, no audit', async () => {
    const c = await counter();

    const res = await adjust(c.cookie, { itemId: c.itemId, quantity: -11, reason: 'theft' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.details).toEqual([
      { itemId: c.itemId, name: expect.any(String), available: 10, requested: 11 },
    ]);
    expect(await stockOf(pool, c.itemId)).toBe(10);
    expect(await movementCount(pool, c.itemId)).toBe(1);
    const { rows } = await pool.query(`select 1 from audit_logs where action = 'stock.adjust'`);
    expect(rows).toHaveLength(0);
  });

  it('takes stock to exactly zero', async () => {
    const c = await counter();
    const res = await adjust(c.cookie, { itemId: c.itemId, quantity: -10, reason: 'expiry' });
    expect(res.status).toBe(201);
    expect(await stockOf(pool, c.itemId)).toBe(0);
  });

  it("answers 404 for another branch's item and for one that does not exist, changing nothing", async () => {
    const c = await counter();
    const other = await counter();

    const theirs = await adjust(c.cookie, { itemId: other.itemId, quantity: -1, reason: 'damage' });
    const missing = await adjust(c.cookie, { itemId: 999999, quantity: -1, reason: 'damage' });

    expect([theirs.status, missing.status]).toEqual([404, 404]);
    expect(await stockOf(pool, other.itemId)).toBe(10);
    expect(await movementCount(pool, other.itemId)).toBe(1);
  });

  it('answers 401 without a session, 403 to the Admin and to a cashier with no branch', async () => {
    const c = await counter();
    const body = { itemId: c.itemId, quantity: -1, reason: 'damage' };
    const admin = await cookieFor(db, await createUser(pool, { role: 'admin' }));
    const noBranch = await cookieFor(db, await createUser(pool, { role: 'cashier' }), null);

    expect((await request(app).post(URL).send(body)).status).toBe(401);
    const byAdmin = await adjust(admin, body);
    const byNoBranch = await adjust(noBranch, body);
    expect([byAdmin.status, byAdmin.body.error.code]).toEqual([403, 'FORBIDDEN']);
    expect([byNoBranch.status, byNoBranch.body.error.code]).toEqual([403, 'NO_ACTIVE_BRANCH']);
    expect(await stockOf(pool, c.itemId)).toBe(10);
  });

  it('lets parallel decreases through only while stock lasts: 5 × −3 on 10 → 3 saved, 1 left', async () => {
    const c = await counter();

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        adjust(c.cookie, { itemId: c.itemId, quantity: -3, reason: 'damage' }),
      ),
    );

    const statuses = results.map((res) => res.status).sort();
    expect(statuses).toEqual([201, 201, 201, 400, 400]);
    expect(await stockOf(pool, c.itemId)).toBe(1);
    expect(await movementCount(pool, c.itemId)).toBe(4);
    await assertLedgerMatchesStock(pool, c.itemId);
  });
});
