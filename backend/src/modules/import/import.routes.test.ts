// The CSV import (Task 3.7): the Admin sends a branch's items and opening stock as one file. Real
// database, real transactions: the point is that a file with any problem saves nothing, that a
// good file leaves stock and the ledger in agreement, and that two imports at once cannot corrupt
// either.
import { readFileSync } from 'node:fs';
import { SELLING_ABOVE_MRP_MESSAGE } from '@ds/shared';
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
import { createApp } from '../../app.js';

const { db, pool } = createTestDb();
const app = createApp({ db });

const HEADER = 'code,barcode,name,category,mrp,selling_price,reorder_level,opening_stock';
/** U+FEFF, the byte order mark Excel puts at the start of a "CSV UTF-8" file. */
const BOM = String.fromCharCode(0xfeff);

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

function fixture(name: string): string {
  return readFileSync(new URL(`../../../test/fixtures/import/${name}`, import.meta.url), 'utf8');
}

interface Admin {
  userId: number;
  cookie: string;
}

/** An Admin with a session (the v1 Admin works in no branch). */
async function admin(): Promise<Admin> {
  const userId = await createUser(pool, { role: 'admin' });
  return { userId, cookie: await cookieFor(db, userId) };
}

const urlFor = (branchId: number | string) => `/api/v1/admin/branches/${branchId}/import`;

/** Send a CSV text as the request body, as the import screen does. */
function upload(cookie: string, branchId: number | string, csv: string) {
  return request(app)
    .post(urlFor(branchId))
    .set('Cookie', cookie)
    .set('Content-Type', 'text/csv')
    .send(csv);
}

async function count(sqlText: string, params: unknown[]): Promise<number> {
  const { rows } = await pool.query(sqlText, params);
  return Number(rows[0].n);
}

const countItems = (branchId: number) =>
  count('select count(*)::int as n from items where branch_id = $1', [branchId]);
const countCategories = (branchId: number) =>
  count('select count(*)::int as n from categories where branch_id = $1', [branchId]);
const countMovements = (branchId: number) =>
  count('select count(*)::int as n from stock_movements where branch_id = $1', [branchId]);
const countAudit = (action: string) =>
  count('select count(*)::int as n from audit_logs where action = $1', [action]);

/** Items whose stock differs from the sum of their ledger rows (D-02): there must be none. */
const ledgerMismatches = (branchId: number) =>
  count(
    `select count(*)::int as n
       from items i
       left join item_stock s on s.item_id = i.id
       left join (select item_id, sum(quantity)::int as total
                    from stock_movements group by item_id) m on m.item_id = i.id
      where i.branch_id = $1 and coalesce(s.quantity, -1) <> coalesce(m.total, 0)`,
    [branchId],
  );

async function categoryNames(branchId: number): Promise<string[]> {
  const { rows } = await pool.query(
    'select name from categories where branch_id = $1 order by lower(name)',
    [branchId],
  );
  return rows.map((row) => row.name);
}

async function storedItems(branchId: number) {
  const { rows } = await pool.query(
    `select i.code, i.barcode, i.name, c.name as category, i.mrp_paise, i.selling_price_paise,
            i.reorder_level, s.quantity
       from items i
       left join categories c on c.id = i.category_id
       join item_stock s on s.item_id = i.id
      where i.branch_id = $1 order by i.code`,
    [branchId],
  );
  return rows.map((row) => ({
    code: row.code,
    barcode: row.barcode,
    name: row.name,
    category: row.category,
    mrpPaise: Number(row.mrp_paise),
    sellingPricePaise: Number(row.selling_price_paise),
    reorderLevel: row.reorder_level,
    stock: Number(row.quantity),
  }));
}

async function storedMovements(branchId: number) {
  const { rows } = await pool.query(
    `select i.code, m.type, m.quantity, m.balance_after, m.ref_type, m.ref_id, m.created_by
       from stock_movements m join items i on i.id = m.item_id
      where m.branch_id = $1 order by i.code`,
    [branchId],
  );
  return rows.map((row) => ({
    code: row.code,
    type: row.type,
    quantity: row.quantity,
    balanceAfter: row.balance_after,
    refType: row.ref_type,
    refId: row.ref_id === null ? null : Number(row.ref_id),
    createdBy: Number(row.created_by),
  }));
}

/** Nothing of the import exists: no categories, no new items, no movements, no audit row. */
async function expectNothingSaved(branchId: number, itemsBefore = 0): Promise<void> {
  expect(await countItems(branchId)).toBe(itemsBefore);
  expect(await countCategories(branchId)).toBe(0);
  expect(await countMovements(branchId)).toBe(0);
  expect(await countAudit('branch.import')).toBe(0);
}

/** A file of `rows` items in 5 categories, each with an opening stock of 1 to 7 packs. */
function bigCsv(rows: number): string {
  const lines = [HEADER];
  for (let i = 1; i <= rows; i++) {
    const n = String(i).padStart(4, '0');
    lines.push(
      `ITEM${n},89012${n},Item ${n},Category ${i % 5},${100 + (i % 50)}.50,${90 + (i % 50)}.00,${i % 10},${(i % 7) + 1}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

describe('access control', () => {
  it('answers 401 without a session', async () => {
    const branchId = await createBranch(pool);
    const res = await request(app)
      .post(urlFor(branchId))
      .set('Content-Type', 'text/csv')
      .send(fixture('valid-5-rows.csv'));
    expect(res.status).toBe(401);
  });

  it('refuses a cashier with 403 FORBIDDEN, and saves nothing', async () => {
    const branchId = await createBranch(pool);
    const userId = await createUser(pool, { role: 'cashier' });
    await mapUser(pool, userId, branchId);
    const cookie = await cookieFor(db, userId, branchId);

    const res = await upload(cookie, branchId, fixture('valid-5-rows.csv'));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await expectNothingSaved(branchId);
  });

  it('answers 404 for a branch that does not exist', async () => {
    const { cookie } = await admin();
    const res = await upload(cookie, 999999, fixture('valid-5-rows.csv'));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it.each(['abc', '0', '1.5'])('refuses the branch id %j with 422', async (id) => {
    const { cookie } = await admin();
    const res = await upload(cookie, id, fixture('valid-5-rows.csv'));
    expect(res.status).toBe(422);
  });
});

describe('what the request must look like', () => {
  it('answers 415 CSV_REQUIRED for a body that is not text/csv', async () => {
    const branchId = await createBranch(pool);
    const { cookie } = await admin();

    const res = await request(app)
      .post(urlFor(branchId))
      .set('Cookie', cookie)
      .send({ csv: HEADER });

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('CSV_REQUIRED');
    await expectNothingSaved(branchId);
  });

  it('refuses an empty text/csv body (an empty file) without a 500, and saves nothing', async () => {
    const branchId = await createBranch(pool);
    const { cookie } = await admin();

    const res = await request(app)
      .post(urlFor(branchId))
      .set('Cookie', cookie)
      .set('Content-Type', 'text/csv');

    // 422 when the parser hands over an empty text, 415 if it leaves the body unset
    expect([415, 422]).toContain(res.status);
    await expectNothingSaved(branchId);
  });

  it('answers 413 PAYLOAD_TOO_LARGE for a file over 5 MB', async () => {
    const branchId = await createBranch(pool);
    const { cookie } = await admin();

    const res = await upload(cookie, branchId, 'x'.repeat(5 * 1024 * 1024 + 1));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('a valid file', () => {
  it('creates the categories, items, stock rows and opening movements, and answers the counts', async () => {
    const branchId = await createBranch(pool);
    const other = await createBranch(pool);
    const { userId, cookie } = await admin();

    const res = await upload(cookie, branchId, fixture('valid-5-rows.csv'));

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ categoriesCreated: 3, itemsCreated: 5, openingMovements: 3 });
    // PEN says "Stationery", NOTEBOOK "stationery": one category, spelt as first seen
    expect(await categoryNames(branchId)).toEqual(['Grocery', 'Personal care', 'stationery']);
    expect(await storedItems(branchId)).toEqual([
      {
        code: 'NOTEBOOK',
        barcode: null,
        name: 'Notebook 200 pages',
        category: 'stationery',
        mrpPaise: 6000,
        sellingPricePaise: 5500,
        reorderLevel: 2,
        stock: 0,
      },
      {
        code: 'OIL1L',
        barcode: '8901234500011',
        name: 'Sunflower oil, 1 l',
        category: 'Grocery',
        mrpPaise: 18550,
        sellingPricePaise: 18000,
        reorderLevel: 10,
        stock: 40,
      },
      {
        code: 'PEN',
        barcode: null,
        name: 'Ball pen',
        category: 'stationery',
        mrpPaise: 1000,
        sellingPricePaise: 1000,
        reorderLevel: null,
        stock: 12,
      },
      {
        code: 'RICE10',
        barcode: '8901234567890',
        name: 'Rice 10 kg',
        category: 'Grocery',
        mrpPaise: 65000,
        sellingPricePaise: 62000,
        reorderLevel: 5,
        stock: 24,
      },
      {
        code: 'SOAP',
        barcode: null,
        name: 'Bath soap',
        category: 'Personal care',
        mrpPaise: 4500,
        sellingPricePaise: 4250,
        reorderLevel: null,
        stock: 0,
      },
    ]);
    // One `opening` row per item with stock above 0; none for a stock of 0 or a blank one
    expect(await storedMovements(branchId)).toEqual([
      {
        code: 'OIL1L',
        type: 'opening',
        quantity: 40,
        balanceAfter: 40,
        refType: 'import',
        refId: null,
        createdBy: userId,
      },
      {
        code: 'PEN',
        type: 'opening',
        quantity: 12,
        balanceAfter: 12,
        refType: 'import',
        refId: null,
        createdBy: userId,
      },
      {
        code: 'RICE10',
        type: 'opening',
        quantity: 24,
        balanceAfter: 24,
        refType: 'import',
        refId: null,
        createdBy: userId,
      },
    ]);
    expect(await ledgerMismatches(branchId)).toBe(0);
    expect(await countItems(other)).toBe(0);
    expect(await countCategories(other)).toBe(0);
  });

  it('records one audit row for the import, with the counts', async () => {
    const branchId = await createBranch(pool);
    const { userId, cookie } = await admin();

    await upload(cookie, branchId, fixture('valid-5-rows.csv'));

    const audit = await expectAudit(db, {
      action: 'branch.import',
      entity: 'branch',
      entityId: branchId,
      actorId: userId,
    });
    expect(audit.branchId).toBe(branchId);
    expect(audit.after).toEqual({ categoriesCreated: 3, itemsCreated: 5, openingMovements: 3 });
    expect(await countAudit('branch.import')).toBe(1);
  });

  it("reuses the branch's categories, in any letter case, and creates only the missing ones", async () => {
    const branchId = await createBranch(pool);
    const other = await createBranch(pool);
    await createCategory(pool, branchId, 'grocery');
    await createCategory(pool, other, 'Personal care');
    const { cookie } = await admin();

    const res = await upload(cookie, branchId, fixture('valid-5-rows.csv'));

    expect(res.status).toBe(201);
    expect(res.body.data.categoriesCreated).toBe(2);
    expect(await categoryNames(branchId)).toEqual(['grocery', 'Personal care', 'stationery']);
    const inGrocery = (await storedItems(branchId)).filter((item) => item.category === 'grocery');
    expect(inGrocery.map((item) => item.code)).toEqual(['OIL1L', 'RICE10']);
    // The other branch's category of the same name stays its own
    expect(await categoryNames(other)).toEqual(['Personal care']);
  });

  it('accepts the columns in any order and letter case, other columns, a BOM and CRLF line ends', async () => {
    const branchId = await createBranch(pool);
    const { cookie } = await admin();
    const csv = `${BOM}${[
      'Notes,NAME,Code,Opening_Stock,selling_price,MRP,Category,Barcode,reorder_level',
      'ignored,Rice 10 kg,RICE10,24,620,650,Grocery,8901,5',
    ].join('\r\n')}\r\n`;

    const res = await upload(cookie, branchId, csv);

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ categoriesCreated: 1, itemsCreated: 1, openingMovements: 1 });
    expect(await storedItems(branchId)).toEqual([
      {
        code: 'RICE10',
        barcode: '8901',
        name: 'Rice 10 kg',
        category: 'Grocery',
        mrpPaise: 65000,
        sellingPricePaise: 62000,
        reorderLevel: 5,
        stock: 24,
      },
    ]);
  });
});

describe('a file with problems', () => {
  it('answers 422 IMPORT_INVALID with every problem in the file, and saves nothing', async () => {
    const branchId = await createBranch(pool);
    await createItem(pool, branchId, { code: 'EXIST1' });
    await createItem(pool, branchId, { code: 'OLDCODE', barcode: '222' });
    const { cookie } = await admin();

    const res = await upload(cookie, branchId, fixture('errors.csv'));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IMPORT_INVALID');
    expect(res.body.error.details).toEqual([
      { row: 3, column: 'mrp', message: expect.any(String) },
      { row: 4, column: 'code', message: expect.any(String) },
      { row: 5, column: 'name', message: expect.any(String) },
      { row: 7, column: 'code', message: 'Code "DUP1" is also used on row 6' },
      { row: 8, column: 'code', message: 'This branch already has an item with code "EXIST1"' },
      { row: 9, column: 'opening_stock', message: expect.any(String) },
      { row: 10, column: 'selling_price', message: SELLING_ABOVE_MRP_MESSAGE },
      { row: 11, column: 'reorder_level', message: expect.any(String) },
      { row: 13, column: 'barcode', message: 'Barcode "111" is also used on row 12' },
      {
        row: 14,
        column: 'barcode',
        message: 'This branch already has an item with barcode "222"',
      },
    ]);
    // The two items that were there stay; the good rows of the file were not imported either
    await expectNothingSaved(branchId, 2);
  });

  it('names the column the header lacks, and checks no row', async () => {
    const branchId = await createBranch(pool);
    const { cookie } = await admin();

    const res = await upload(cookie, branchId, fixture('missing-column.csv'));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IMPORT_INVALID');
    expect(res.body.error.details).toEqual([
      { row: 1, column: 'mrp', message: expect.any(String) },
    ]);
    await expectNothingSaved(branchId);
  });

  it('names a column that appears twice in the header', async () => {
    const branchId = await createBranch(pool);
    const { cookie } = await admin();
    const csv = `code,${HEADER}\nA1,A1,,Item,Grocery,100,90,,5\n`;

    const res = await upload(cookie, branchId, csv);

    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([
      { row: 1, column: 'code', message: expect.any(String) },
    ]);
    await expectNothingSaved(branchId);
  });

  it.each([
    ['only the header row', `${HEADER}\n`],
    ['only a blank line', '\n'],
  ])('answers a file with %s with one problem, and saves nothing', async (_label, csv) => {
    const branchId = await createBranch(pool);
    const { cookie } = await admin();

    const res = await upload(cookie, branchId, csv);

    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([{ row: 1, column: null, message: expect.any(String) }]);
    await expectNothingSaved(branchId);
  });

  it('flags a row with more values than the header (an unquoted comma), and still checks the rest', async () => {
    const branchId = await createBranch(pool);
    const { cookie } = await admin();
    const csv = [
      HEADER,
      'A1,,"Quoted, fine",Grocery,100,90,,5',
      'A2,,Rice, 10 kg,Grocery,100,90,,5',
      'A3,,Bad price,Grocery,xyz,90,,',
    ].join('\n');

    const res = await upload(cookie, branchId, csv);

    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([
      { row: 3, column: null, message: expect.stringContaining('9 values') },
      { row: 4, column: 'mrp', message: expect.any(String) },
    ]);
    await expectNothingSaved(branchId);
  });

  it('counts blank lines, so a row number is the line in the file', async () => {
    const branchId = await createBranch(pool);
    const { cookie } = await admin();
    const csv = [HEADER, 'A1,,Good,Grocery,100,90,,5', '', 'A2,,Bad,Grocery,abc,90,,'].join('\n');

    const res = await upload(cookie, branchId, csv);

    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([
      { row: 4, column: 'mrp', message: expect.any(String) },
    ]);
  });

  it('reports a quote that is never closed as one problem with the file', async () => {
    const branchId = await createBranch(pool);
    const { cookie } = await admin();
    const csv = `${HEADER}\nA1,,"Never closed,Grocery,100,90,,5\n`;

    const res = await upload(cookie, branchId, csv);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IMPORT_INVALID');
    expect(res.body.error.details).toEqual([
      { row: expect.any(Number), column: null, message: expect.stringContaining('not valid CSV') },
    ]);
    await expectNothingSaved(branchId);
  });

  it('refuses the same file a second time: every code and barcode is already in the branch', async () => {
    const branchId = await createBranch(pool);
    const { cookie } = await admin();
    expect((await upload(cookie, branchId, fixture('valid-5-rows.csv'))).status).toBe(201);

    const again = await upload(cookie, branchId, fixture('valid-5-rows.csv'));

    expect(again.status).toBe(422);
    expect(again.body.error.details).toHaveLength(7);
    expect(again.body.error.details.slice(0, 2)).toEqual([
      { row: 2, column: 'code', message: 'This branch already has an item with code "RICE10"' },
      {
        row: 2,
        column: 'barcode',
        message: 'This branch already has an item with barcode "8901234567890"',
      },
    ]);
    expect(await countItems(branchId)).toBe(5);
    expect(await countAudit('branch.import')).toBe(1);
  });
});

describe('all or nothing, and safe under concurrency', () => {
  it('saves nothing when a step fails after the categories were written', async () => {
    const branchId = await createBranch(pool);
    const { cookie } = await admin();
    const model = await import('./import.model.js');
    const failing = vi.spyOn(model, 'insertItems').mockRejectedValueOnce(new Error('items failed'));

    let status: number;
    try {
      status = (await upload(cookie, branchId, fixture('valid-5-rows.csv'))).status;
    } finally {
      failing.mockRestore();
    }

    expect(status).toBe(500);
    await expectNothingSaved(branchId);
  });

  it('imports the same file sent twice at once only once, and never answers 500', async () => {
    const branchId = await createBranch(pool);
    const first = await admin();
    const second = await admin();
    const csv = fixture('valid-5-rows.csv');

    const [a, b] = await Promise.all([
      upload(first.cookie, branchId, csv),
      upload(second.cookie, branchId, csv),
    ]);

    // One wins; the other is refused as a conflict (400) or, if it started late, as duplicates (422)
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(201);
    expect([400, 422]).toContain(statuses[1]);
    expect(await countItems(branchId)).toBe(5);
    expect(await countMovements(branchId)).toBe(3);
    expect(await countAudit('branch.import')).toBe(1);
    expect(await ledgerMismatches(branchId)).toBe(0);
  });
});

describe('a large file', () => {
  it('imports 1,000 rows in under 10 seconds, and the ledger matches stock', async () => {
    const branchId = await createBranch(pool);
    const { cookie } = await admin();

    const started = Date.now();
    const res = await upload(cookie, branchId, bigCsv(1000));
    const seconds = (Date.now() - started) / 1000;

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      categoriesCreated: 5,
      itemsCreated: 1000,
      openingMovements: 1000,
    });
    expect(seconds).toBeLessThan(10);
    expect(await countItems(branchId)).toBe(1000);
    expect(await countMovements(branchId)).toBe(1000);
    expect(await ledgerMismatches(branchId)).toBe(0);
    // The opening stocks are (i mod 7) + 1 for i = 1..1000, which add up to 4003 packs
    expect(
      await count(
        `select coalesce(sum(s.quantity), 0)::int as n
           from item_stock s join items i on i.id = s.item_id where i.branch_id = $1`,
        [branchId],
      ),
    ).toBe(4003);
  });
});
