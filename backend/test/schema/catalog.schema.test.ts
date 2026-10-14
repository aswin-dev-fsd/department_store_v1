// Database-level rules for the catalog and ledger tables (Task 3.1). Raw SQL on purpose: these
// prove PostgreSQL itself enforces the rules, whatever the application code does.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb } from '../helpers/db.js';

const { db, pool } = createTestDb();

// PostgreSQL error codes
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const INVALID_ENUM_VALUE = '22P02';

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

async function insertBranch(code: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `insert into branches (code, name, address) values ($1, 'Branch', 'Address') returning id`,
    [code],
  );
  return Number(rows[0]!.id);
}

async function insertUser(username = 'ravi'): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `insert into users (username, password_hash, full_name, role)
     values ($1, 'hash', 'Test User', 'cashier') returning id`,
    [username],
  );
  return Number(rows[0]!.id);
}

async function insertCategory(branchId: number, name: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `insert into categories (branch_id, name) values ($1, $2) returning id`,
    [branchId, name],
  );
  return Number(rows[0]!.id);
}

async function insertItem(
  branchId: number,
  code: string,
  { barcode = null as string | null, name = 'Rice 10 kg' } = {},
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `insert into items (branch_id, code, barcode, name, mrp_paise, selling_price_paise)
     values ($1, $2, $3, $4, 50000, 48000) returning id`,
    [branchId, code, barcode, name],
  );
  return Number(rows[0]!.id);
}

async function insertStock(itemId: number, quantity: number) {
  await pool.query(`insert into item_stock (item_id, quantity) values ($1, $2)`, [
    itemId,
    quantity,
  ]);
}

async function insertMovement(
  branchId: number,
  itemId: number,
  userId: number,
  overrides: { quantity?: number; type?: string; refType?: string; reason?: string | null } = {},
) {
  await pool.query(
    `insert into stock_movements
       (branch_id, item_id, type, quantity, balance_after, ref_type, reason, created_by)
     values ($1, $2, $3, $4, 5, $5, $6, $7)`,
    [
      branchId,
      itemId,
      overrides.type ?? 'opening',
      overrides.quantity ?? 5,
      overrides.refType ?? 'import',
      overrides.reason ?? null,
      userId,
    ],
  );
}

describe('catalog and ledger tables exist', () => {
  it('has every table in the public schema', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const tables = rows.map((r) => r.table_name);
    for (const table of ['categories', 'items', 'item_stock', 'vendors', 'stock_movements']) {
      expect(tables).toContain(table);
    }
  });
});

describe('categories', () => {
  it('keeps names unique per branch, ignoring case', async () => {
    const a = await insertBranch('TPR');
    await insertCategory(a, 'Grocery');
    await expect(insertCategory(a, 'grocery')).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('allows the same name in another branch', async () => {
    const a = await insertBranch('TPR');
    const b = await insertBranch('CBE');
    await insertCategory(a, 'Grocery');
    await insertCategory(b, 'Grocery');
  });

  it('needs a real branch', async () => {
    await expect(insertCategory(999999, 'Grocery')).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
  });
});

describe('items', () => {
  it('keeps the code unique per branch, and allows it in another branch', async () => {
    const a = await insertBranch('TPR');
    const b = await insertBranch('CBE');
    await insertItem(a, 'R10');
    await expect(insertItem(a, 'R10')).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    await insertItem(b, 'R10');
  });

  it('keeps a barcode unique per branch, and allows it in another branch', async () => {
    const a = await insertBranch('TPR');
    const b = await insertBranch('CBE');
    await insertItem(a, 'R10', { barcode: '8901234567890' });
    await expect(insertItem(a, 'R11', { barcode: '8901234567890' })).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
    });
    await insertItem(b, 'R10', { barcode: '8901234567890' });
  });

  it('lets any number of items in a branch have no barcode', async () => {
    const a = await insertBranch('TPR');
    await insertItem(a, 'R10');
    await insertItem(a, 'R11');
    await insertItem(a, 'R12');
  });

  it('starts active, with the pending-feature columns empty', async () => {
    const a = await insertBranch('TPR');
    const id = await insertItem(a, 'R10');
    const { rows } = await pool.query(
      `select is_active, hsn_code, gst_rate, reorder_level, category_id from items where id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({
      is_active: true,
      hsn_code: null,
      gst_rate: null,
      reorder_level: null,
      category_id: null,
    });
  });

  it('takes prices as whole paise (bigint)', async () => {
    const { rows } = await pool.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
        where table_name = 'items' and column_name in ('mrp_paise', 'selling_price_paise')`,
    );
    expect(rows.map((r) => r.data_type)).toEqual(['bigint', 'bigint']);
  });

  it('can belong to a category', async () => {
    const a = await insertBranch('TPR');
    const category = await insertCategory(a, 'Grocery');
    await pool.query(
      `insert into items (branch_id, code, name, category_id, mrp_paise, selling_price_paise)
       values ($1, 'R10', 'Rice 10 kg', $2, 100, 90)`,
      [a, category],
    );
  });

  it('cannot lose its category by deleting it (items are never orphaned silently)', async () => {
    const a = await insertBranch('TPR');
    const category = await insertCategory(a, 'Grocery');
    await pool.query(
      `insert into items (branch_id, code, name, category_id, mrp_paise, selling_price_paise)
       values ($1, 'R10', 'Rice 10 kg', $2, 100, 90)`,
      [a, category],
    );
    await expect(
      pool.query(`delete from categories where id = $1`, [category]),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^2300[01]$/) as unknown as string });
  });

  it('needs a real branch', async () => {
    await expect(insertItem(999999, 'R10')).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
  });

  it('has an index to search a branch by lower-cased name', async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'items'`,
    );
    expect(rows.some((r) => /branch_id, lower\(name\)/.test(r.indexdef))).toBe(true);
  });
});

describe('item_stock', () => {
  it('holds one row per item', async () => {
    const a = await insertBranch('TPR');
    const item = await insertItem(a, 'R10');
    await insertStock(item, 0);
    await expect(insertStock(item, 3)).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('accepts zero and positive quantities', async () => {
    const a = await insertBranch('TPR');
    await insertStock(await insertItem(a, 'R10'), 0);
    await insertStock(await insertItem(a, 'R11'), 7);
  });

  it('refuses a negative quantity: stock can never go below zero', async () => {
    const a = await insertBranch('TPR');
    const item = await insertItem(a, 'R10');
    await expect(insertStock(item, -1)).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  it('refuses to take stock below zero by an update, too', async () => {
    const a = await insertBranch('TPR');
    const item = await insertItem(a, 'R10');
    await insertStock(item, 2);
    await expect(
      pool.query(`update item_stock set quantity = quantity - 3 where item_id = $1`, [item]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  it('needs a real item', async () => {
    await expect(insertStock(999999, 1)).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
  });
});

describe('vendors', () => {
  it('stores a vendor for a branch, active by default', async () => {
    const a = await insertBranch('TPR');
    const { rows } = await pool.query(
      `insert into vendors (branch_id, name) values ($1, 'Sri Traders') returning is_active, phone, gstin, address`,
      [a],
    );
    expect(rows[0]).toEqual({ is_active: true, phone: null, gstin: null, address: null });
  });

  it('needs a real branch', async () => {
    await expect(
      pool.query(`insert into vendors (branch_id, name) values (999999, 'Sri Traders')`),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
  });
});

describe('stock_movements', () => {
  it('records a signed, non-zero quantity', async () => {
    const a = await insertBranch('TPR');
    const user = await insertUser();
    const item = await insertItem(a, 'R10');
    await insertMovement(a, item, user, { quantity: 5 });
    await insertMovement(a, item, user, { quantity: -2, type: 'sale', refType: 'bill' });
  });

  it('refuses a zero quantity: a movement must move something', async () => {
    const a = await insertBranch('TPR');
    const user = await insertUser();
    const item = await insertItem(a, 'R10');
    await expect(insertMovement(a, item, user, { quantity: 0 })).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    });
  });

  it.each(['opening', 'purchase', 'purchase_cancel', 'sale', 'sale_cancel', 'adjustment'])(
    'accepts the movement type %s',
    async (type) => {
      const a = await insertBranch('TPR');
      const user = await insertUser();
      const item = await insertItem(a, 'R10');
      await insertMovement(a, item, user, { type });
    },
  );

  it('refuses an unknown movement type', async () => {
    const a = await insertBranch('TPR');
    const user = await insertUser();
    const item = await insertItem(a, 'R10');
    await expect(insertMovement(a, item, user, { type: 'return' })).rejects.toMatchObject({
      code: INVALID_ENUM_VALUE,
    });
  });

  it.each(['bill', 'purchase', 'adjustment', 'import'])(
    'accepts the reference type %s',
    async (refType) => {
      const a = await insertBranch('TPR');
      const user = await insertUser();
      const item = await insertItem(a, 'R10');
      await insertMovement(a, item, user, { refType });
    },
  );

  it('refuses an unknown reference type', async () => {
    const a = await insertBranch('TPR');
    const user = await insertUser();
    const item = await insertItem(a, 'R10');
    await expect(insertMovement(a, item, user, { refType: 'order' })).rejects.toMatchObject({
      code: INVALID_ENUM_VALUE,
    });
  });

  it.each(['damage', 'expiry', 'theft', 'count_correction', 'other'])(
    'accepts the adjustment reason %s',
    async (reason) => {
      const a = await insertBranch('TPR');
      const user = await insertUser();
      const item = await insertItem(a, 'R10');
      await insertMovement(a, item, user, { type: 'adjustment', refType: 'adjustment', reason });
    },
  );

  it('refuses an unknown adjustment reason', async () => {
    const a = await insertBranch('TPR');
    const user = await insertUser();
    const item = await insertItem(a, 'R10');
    await expect(
      insertMovement(a, item, user, { type: 'adjustment', refType: 'adjustment', reason: 'lost' }),
    ).rejects.toMatchObject({ code: INVALID_ENUM_VALUE });
  });

  it('keeps the pending-feature columns, empty', async () => {
    const a = await insertBranch('TPR');
    const user = await insertUser();
    const item = await insertItem(a, 'R10');
    await insertMovement(a, item, user);
    const { rows } = await pool.query(
      `select batch_no, expiry_date, ref_id, reason, note from stock_movements`,
    );
    expect(rows[0]).toEqual({
      batch_no: null,
      expiry_date: null,
      ref_id: null,
      reason: null,
      note: null,
    });
  });

  it('needs a real branch, item and user', async () => {
    const a = await insertBranch('TPR');
    const user = await insertUser();
    const item = await insertItem(a, 'R10');
    await expect(insertMovement(999999, item, user)).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
    await expect(insertMovement(a, 999999, user)).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
    await expect(insertMovement(a, item, 999999)).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
  });

  it("has an index on (item_id, created_at) for an item's history", async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'stock_movements'`,
    );
    expect(rows.some((r) => /item_id, created_at/.test(r.indexdef))).toBe(true);
  });
});
