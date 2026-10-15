// The dev seed (Task 3.8). The demo catalogue is checked without a database; the seeding itself
// runs once against the real test database, so the services it calls are exercised for real.
import { IMPORT_COLUMNS, importRowSchema } from '@ds/shared';
import { parse } from 'csv-parse/sync';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb } from '../../test/helpers/db.js';
import { createBranch, createClientSettings, createUser } from '../../test/helpers/fixtures.js';
import { verifyPassword } from '../modules/auth/auth.service.js';
import {
  barcodeOf,
  catalogCsv,
  ean13,
  openingStock,
  PRODUCTS,
  seedDev,
  type SeedResult,
} from './seed-dev.js';

const { db, pool } = createTestDb();

afterAll(async () => {
  await pool.end();
});

/** Row counts: to prove that a refused or repeated run changed nothing. */
async function snapshot() {
  const { rows } = await pool.query(`
    select (select count(*)::int from client_settings) as settings,
           (select count(*)::int from users) as users,
           (select count(*)::int from branches) as branches,
           (select count(*)::int from categories) as categories,
           (select count(*)::int from items) as items,
           (select count(*)::int from stock_movements) as movements,
           (select count(*)::int from audit_logs) as audits`);
  return rows[0];
}

const EMPTY = {
  settings: 0,
  users: 0,
  branches: 0,
  categories: 0,
  items: 0,
  movements: 0,
  audits: 0,
};

/** The rows of the catalogue CSV for a branch, as the import reads them. */
function catalogRecords(branchIndex: number): Record<string, string>[] {
  return parse(catalogCsv(branchIndex), { columns: true }) as Record<string, string>[];
}

describe('the demo catalogue', () => {
  it('has 50 products, 10 in each of 5 categories, with unique codes and names without commas', () => {
    expect(PRODUCTS).toHaveLength(50);
    const perCategory = new Map<string, number>();
    for (const [, , category] of PRODUCTS) {
      perCategory.set(category, (perCategory.get(category) ?? 0) + 1);
    }
    expect([...perCategory.keys()].sort()).toEqual([
      'Beverages',
      'Grocery',
      'Household',
      'Personal care',
      'Stationery',
    ]);
    expect([...perCategory.values()]).toEqual([10, 10, 10, 10, 10]);
    expect(new Set(PRODUCTS.map(([code]) => code)).size).toBe(50);
    for (const [, name] of PRODUCTS) expect(name).not.toMatch(/[,"\n]/);
  });

  it('prices every product with the selling price not above the MRP', () => {
    for (const [code, , , mrp, selling] of PRODUCTS) {
      expect(mrp, code).toBeGreaterThan(0);
      expect(selling, code).toBeGreaterThan(0);
      expect(selling, code).toBeLessThanOrEqual(mrp);
    }
  });

  it('gives each product a different, valid EAN-13 barcode', () => {
    const barcodes = PRODUCTS.map((_product, index) => barcodeOf(index));
    expect(new Set(barcodes).size).toBe(50);
    for (const barcode of barcodes) {
      expect(barcode).toMatch(/^\d{13}$/);
      expect(ean13(barcode.slice(0, 12))).toBe(barcode);
    }
  });

  it('computes the EAN-13 check digit', () => {
    expect(ean13('400638133393')).toBe('4006381333931');
    expect(ean13('590123412345')).toBe('5901234123457');
  });

  it.each([0, 1])('makes a file the import accepts for branch %i: its header, 50 valid rows', (branch) => {
    const records = catalogRecords(branch);
    expect(parse(catalogCsv(branch))[0]).toEqual([...IMPORT_COLUMNS]);
    expect(records).toHaveLength(50);
    for (const record of records) {
      const row = importRowSchema.safeParse(record);
      expect(row.success, record.code).toBe(true);
      if (row.success) expect(row.data.selling_price).toBeLessThanOrEqual(row.data.mrp);
    }
  });

  it.each([0, 1])('leaves 3 items sold out and 4 below their reorder level at branch %i', (branch) => {
    const stocks = PRODUCTS.map(([, , , , , reorder], index) => ({
      stock: openingStock(index, branch),
      reorder,
    }));
    expect(stocks.filter((item) => item.stock === 0)).toHaveLength(3);
    expect(stocks.filter((item) => item.stock > 0 && item.stock < item.reorder)).toHaveLength(4);
    expect(stocks.filter((item) => item.stock >= item.reorder).length).toBe(43);
  });

  it('is the same on every call: the stock differs by branch but not by run', () => {
    expect(catalogCsv(0)).toBe(catalogCsv(0));
    expect(catalogCsv(0)).not.toBe(catalogCsv(1));
  });
});

describe('seedDev on an empty database', () => {
  let result: SeedResult;

  beforeAll(async () => {
    await resetDb(db);
    result = await seedDev(db, { nodeEnv: 'test' });
  }, 120_000);

  function seeded() {
    if (result.status !== 'seeded') throw new Error('the first run should have seeded');
    return result;
  }

  it('creates the client settings, an Admin and two cashiers, who must all change their password', async () => {
    const settings = await pool.query('select business_name from client_settings');
    expect(settings.rows).toEqual([{ business_name: 'Demo Department Store' }]);

    const users = await pool.query(
      'select username, role, is_active, must_change_password from users order by id',
    );
    expect(users.rows).toEqual([
      { username: 'admin', role: 'admin', is_active: true, must_change_password: true },
      { username: 'cashier1', role: 'cashier', is_active: true, must_change_password: true },
      { username: 'cashier2', role: 'cashier', is_active: true, must_change_password: true },
    ]);
  });

  it('returns each account with its own temporary password, which is the one stored (as a hash)', async () => {
    const { accounts } = seeded();
    expect(accounts.map((account) => account.username)).toEqual(['admin', 'cashier1', 'cashier2']);
    const passwords = accounts.map((account) => account.temporaryPassword);
    for (const password of passwords) expect(password).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(new Set(passwords).size).toBe(3);

    const { rows } = await pool.query('select username, password_hash from users');
    for (const account of accounts) {
      const stored = rows.find((row) => row.username === account.username);
      expect(stored.password_hash).not.toContain(account.temporaryPassword);
      await expect(verifyPassword(account.temporaryPassword, stored.password_hash)).resolves.toBe(
        true,
      );
    }
  });

  it('creates the branches TPR and CBE, and maps the cashiers to them (the Admin to none)', async () => {
    const branches = await pool.query('select code, name, is_active from branches order by code');
    expect(branches.rows).toEqual([
      { code: 'CBE', name: 'Coimbatore', is_active: true },
      { code: 'TPR', name: 'Tiruppur', is_active: true },
    ]);

    const { rows } = await pool.query(
      `select u.username, b.code
         from user_branches ub join users u on u.id = ub.user_id join branches b on b.id = ub.branch_id
        order by u.username, b.code`,
    );
    expect(rows).toEqual([
      { username: 'cashier1', code: 'TPR' },
      { username: 'cashier2', code: 'CBE' },
      { username: 'cashier2', code: 'TPR' },
    ]);
  });

  it('creates 5 categories and 50 items in each branch, 10 per category, all with barcodes', async () => {
    const { rows } = await pool.query(
      `select b.code, count(distinct c.id)::int as categories, count(i.id)::int as items,
              count(distinct i.barcode)::int as barcodes,
              count(*) filter (where i.mrp_paise >= i.selling_price_paise and i.selling_price_paise > 0)::int as priced
         from branches b
         join categories c on c.branch_id = b.id
         join items i on i.category_id = c.id
        group by b.code order by b.code`,
    );
    expect(rows).toEqual([
      { code: 'CBE', categories: 5, items: 50, barcodes: 50, priced: 50 },
      { code: 'TPR', categories: 5, items: 50, barcodes: 50, priced: 50 },
    ]);

    const perCategory = await pool.query(
      `select c.name, count(*)::int as items
         from items i join categories c on c.id = i.category_id
        group by c.name order by c.name`,
    );
    expect(perCategory.rows).toEqual([
      { name: 'Beverages', items: 20 },
      { name: 'Grocery', items: 20 },
      { name: 'Household', items: 20 },
      { name: 'Personal care', items: 20 },
      { name: 'Stationery', items: 20 },
    ]);
  });

  it('stores prices in paise, taking the first product as the example', async () => {
    const { rows } = await pool.query(
      `select b.code, i.mrp_paise, i.selling_price_paise, i.reorder_level
         from items i join branches b on b.id = i.branch_id
        where i.code = 'GRC001' order by b.code`,
    );
    expect(rows).toEqual([
      { code: 'CBE', mrp_paise: '52500', selling_price_paise: '49900', reorder_level: 10 },
      { code: 'TPR', mrp_paise: '52500', selling_price_paise: '49900', reorder_level: 10 },
    ]);
  });

  it('puts the opening stock through the ledger: an `opening` row for each item with stock, and stock equals the ledger', async () => {
    const { branches } = seeded();
    expect(branches).toEqual([
      {
        code: 'TPR',
        name: 'Tiruppur',
        categoriesCreated: 5,
        itemsCreated: 50,
        openingMovements: 47,
      },
      {
        code: 'CBE',
        name: 'Coimbatore',
        categoriesCreated: 5,
        itemsCreated: 50,
        openingMovements: 47,
      },
    ]);

    const admin = await pool.query("select id from users where username = 'admin'");
    const { rows } = await pool.query(
      `select b.code, count(*)::int as movements,
              count(*) filter (where m.type = 'opening' and m.ref_type = 'import'
                                 and m.created_by = $1)::int as opening
         from stock_movements m join branches b on b.id = m.branch_id
        group by b.code order by b.code`,
      [admin.rows[0].id],
    );
    expect(rows).toEqual([
      { code: 'CBE', movements: 47, opening: 47 },
      { code: 'TPR', movements: 47, opening: 47 },
    ]);

    const mismatches = await pool.query(
      `select count(*)::int as n
         from items i
         join item_stock s on s.item_id = i.id
         left join (select item_id, sum(quantity)::int as total
                      from stock_movements group by item_id) m on m.item_id = i.id
        where s.quantity <> coalesce(m.total, 0)`,
    );
    expect(mismatches.rows[0].n).toBe(0);
  });

  it('leaves items sold out and items below their reorder level in each branch, to try billing and low-stock screens', async () => {
    const { rows } = await pool.query(
      `select b.code,
              count(*) filter (where s.quantity = 0)::int as sold_out,
              count(*) filter (where s.quantity < i.reorder_level)::int as below_reorder
         from items i
         join item_stock s on s.item_id = i.id
         join branches b on b.id = i.branch_id
        group by b.code order by b.code`,
    );
    // Sold-out items are below their reorder level too: 3 + 4
    expect(rows).toEqual([
      { code: 'CBE', sold_out: 3, below_reorder: 7 },
      { code: 'TPR', sold_out: 3, below_reorder: 7 },
    ]);
  });

  it('audits every step it takes', async () => {
    const { rows } = await pool.query(
      'select action, count(*)::int as n from audit_logs group by action order by action',
    );
    expect(rows).toEqual([
      { action: 'branch.create', n: 2 },
      { action: 'branch.import', n: 2 },
      { action: 'client_settings.create', n: 1 },
      { action: 'user.branches_update', n: 2 },
      { action: 'user.create', n: 3 },
    ]);
  });

  it('answers "already seeded" on a second run, and changes nothing', async () => {
    const before = await snapshot();

    const again = await seedDev(db, { nodeEnv: 'test' });

    expect(again).toEqual({ status: 'already-seeded' });
    expect(await snapshot()).toEqual(before);
  });
});

describe('seedDev refusals', () => {
  beforeEach(async () => {
    await resetDb(db);
  });

  it('never runs in production, and changes nothing', async () => {
    await expect(seedDev(db, { nodeEnv: 'production' })).rejects.toMatchObject({
      code: 'SEED_REFUSED',
    });
    expect(await snapshot()).toEqual(EMPTY);
  });

  it.each([
    ['a user', () => createUser(pool)],
    ['a branch', () => createBranch(pool)],
    ['the client settings', () => createClientSettings(pool)],
  ])('refuses a database that already has %s of its own, and changes nothing', async (_label, add) => {
    await add();
    const before = await snapshot();

    await expect(seedDev(db, { nodeEnv: 'test' })).rejects.toMatchObject({ code: 'NOT_EMPTY' });

    expect(await snapshot()).toEqual(before);
  });

  it('does not take one of the two seed branches for a finished seed', async () => {
    await createBranch(pool, { code: 'TPR' });

    await expect(seedDev(db, { nodeEnv: 'test' })).rejects.toMatchObject({ code: 'NOT_EMPTY' });
  });
});
