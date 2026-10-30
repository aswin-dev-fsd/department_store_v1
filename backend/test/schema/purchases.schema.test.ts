// Database-level rules for the purchase tables (Task 4.1). Raw SQL on purpose: these prove
// PostgreSQL itself enforces the rules, whatever the application code does.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb } from '../helpers/db.js';

const { db, pool } = createTestDb();

// PostgreSQL error codes
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const NOT_NULL_VIOLATION = '23502';
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

async function insertVendor(branchId: number, name = 'Sri Murugan Traders'): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `insert into vendors (branch_id, name) values ($1, $2) returning id`,
    [branchId, name],
  );
  return Number(rows[0]!.id);
}

async function insertItem(branchId: number, code = 'R10'): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `insert into items (branch_id, code, name, mrp_paise, selling_price_paise)
     values ($1, $2, 'Rice 10 kg', 50000, 48000) returning id`,
    [branchId, code],
  );
  return Number(rows[0]!.id);
}

async function insertPurchase(
  branchId: number,
  vendorId: number,
  userId: number,
  { invoice = 'INV-1', status = 'draft' } = {},
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `insert into purchases
       (branch_id, vendor_id, vendor_invoice_no, invoice_date, status, total_paise, created_by)
     values ($1, $2, $3, '2026-10-30', $4, 0, $5) returning id`,
    [branchId, vendorId, invoice, status, userId],
  );
  return Number(rows[0]!.id);
}

async function insertLine(
  purchaseId: number,
  itemId: number,
  { quantity = 10, cost = 45000 } = {},
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `insert into purchase_lines (purchase_id, item_id, quantity, cost_price_paise, line_total_paise)
     values ($1, $2, $3, $4, $5) returning id`,
    [purchaseId, itemId, quantity, cost, quantity * cost],
  );
  return Number(rows[0]!.id);
}

async function setStatus(purchaseId: number, status: string) {
  await pool.query(`update purchases set status = $2 where id = $1`, [purchaseId, status]);
}

/** A branch with a cashier, a vendor and an item: what every purchase needs. */
async function setup() {
  const branch = await insertBranch('TPR');
  const user = await insertUser();
  const vendor = await insertVendor(branch);
  const item = await insertItem(branch);
  return { branch, user, vendor, item };
}

describe('purchase tables exist', () => {
  it('has both tables in the public schema', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const tables = rows.map((r) => r.table_name);
    expect(tables).toContain('purchases');
    expect(tables).toContain('purchase_lines');
  });
});

describe('purchases', () => {
  it('starts as a draft, with the post and cancel fields empty', async () => {
    const { branch, user, vendor } = await setup();
    const id = await pool.query(
      `insert into purchases
         (branch_id, vendor_id, vendor_invoice_no, invoice_date, total_paise, created_by)
       values ($1, $2, 'INV-1', '2026-10-30', 0, $3) returning id`,
      [branch, vendor, user],
    );
    const { rows } = await pool.query(
      `select status, notes, posted_by, posted_at, cancelled_by, cancelled_at, cancel_reason,
              invoice_date::text as invoice_date, updated_at is not null as has_updated_at
         from purchases where id = $1`,
      [id.rows[0].id],
    );
    expect(rows[0]).toEqual({
      status: 'draft',
      notes: null,
      posted_by: null,
      posted_at: null,
      cancelled_by: null,
      cancelled_at: null,
      cancel_reason: null,
      invoice_date: '2026-10-30',
      has_updated_at: true,
    });
  });

  it('needs a total: the server always computes and stores it', async () => {
    const { branch, user, vendor } = await setup();
    await expect(
      pool.query(
        `insert into purchases (branch_id, vendor_id, vendor_invoice_no, invoice_date, created_by)
         values ($1, $2, 'INV-1', '2026-10-30', $3)`,
        [branch, vendor, user],
      ),
    ).rejects.toMatchObject({ code: NOT_NULL_VIOLATION });
  });

  it('refuses an unknown status', async () => {
    const { branch, user, vendor } = await setup();
    await expect(
      insertPurchase(branch, vendor, user, { status: 'deleted' }),
    ).rejects.toMatchObject({ code: INVALID_ENUM_VALUE });
  });

  it('refuses the same vendor invoice twice in a branch, in any letter case, drafts included', async () => {
    const { branch, user, vendor } = await setup();
    await insertPurchase(branch, vendor, user, { invoice: 'INV-1' });
    await expect(
      insertPurchase(branch, vendor, user, { invoice: 'inv-1' }),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('refuses it while the earlier one is posted, too', async () => {
    const { branch, user, vendor } = await setup();
    await insertPurchase(branch, vendor, user, { status: 'posted' });
    await expect(insertPurchase(branch, vendor, user)).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
    });
  });

  it('allows the invoice again once the earlier one is cancelled, as often as it is cancelled', async () => {
    const { branch, user, vendor } = await setup();
    const first = await insertPurchase(branch, vendor, user, { status: 'posted' });
    await setStatus(first, 'cancelled');

    const second = await insertPurchase(branch, vendor, user);
    await setStatus(second, 'cancelled');
    await insertPurchase(branch, vendor, user);

    const { rows } = await pool.query(
      `select status, count(*)::int as n from purchases group by status order by status`,
    );
    expect(rows).toEqual([
      { status: 'draft', n: 1 },
      { status: 'cancelled', n: 2 },
    ]);
  });

  it('refuses to bring a cancelled purchase back while the invoice is in use again', async () => {
    const { branch, user, vendor } = await setup();
    const first = await insertPurchase(branch, vendor, user, { status: 'posted' });
    await setStatus(first, 'cancelled');
    await insertPurchase(branch, vendor, user);

    await expect(setStatus(first, 'posted')).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('allows the same invoice number from another vendor, and in another branch', async () => {
    const { branch, user, vendor } = await setup();
    const otherVendor = await insertVendor(branch, 'Kovai Wholesale');
    const otherBranch = await insertBranch('CBE');
    const vendorThere = await insertVendor(otherBranch);

    await insertPurchase(branch, vendor, user);
    await insertPurchase(branch, otherVendor, user);
    await insertPurchase(otherBranch, vendorThere, user);
  });

  it('needs a real branch, vendor and user', async () => {
    const { branch, user, vendor } = await setup();
    await expect(insertPurchase(999999, vendor, user)).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
    await expect(insertPurchase(branch, 999999, user)).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
    await expect(insertPurchase(branch, vendor, 999999)).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
  });
});

describe('purchase_lines', () => {
  it('stores a line, with the new prices and the pending-feature columns empty', async () => {
    const { branch, user, vendor, item } = await setup();
    const purchase = await insertPurchase(branch, vendor, user);
    await insertLine(purchase, item, { quantity: 12, cost: 45000 });
    const { rows } = await pool.query(
      `select quantity, cost_price_paise, line_total_paise, new_mrp_paise, new_selling_price_paise,
              batch_no, expiry_date
         from purchase_lines`,
    );
    expect(rows[0]).toEqual({
      quantity: 12,
      cost_price_paise: '45000',
      line_total_paise: '540000',
      new_mrp_paise: null,
      new_selling_price_paise: null,
      batch_no: null,
      expiry_date: null,
    });
  });

  it.each([0, -1])('refuses a quantity of %i: a line must bring something in', async (quantity) => {
    const { branch, user, vendor, item } = await setup();
    const purchase = await insertPurchase(branch, vendor, user);
    await expect(insertLine(purchase, item, { quantity })).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    });
  });

  it('accepts a cost price of zero (a free item) but not a negative one', async () => {
    const { branch, user, vendor, item } = await setup();
    const purchase = await insertPurchase(branch, vendor, user);
    await insertLine(purchase, item, { cost: 0 });
    await expect(insertLine(purchase, item, { cost: -1 })).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    });
  });

  it('keeps a batch number and expiry date when they are given (PD-02)', async () => {
    const { branch, user, vendor, item } = await setup();
    const purchase = await insertPurchase(branch, vendor, user);
    await pool.query(
      `insert into purchase_lines
         (purchase_id, item_id, quantity, cost_price_paise, line_total_paise, batch_no, expiry_date)
       values ($1, $2, 5, 1000, 5000, 'B-204', '2027-03-31')`,
      [purchase, item],
    );
    // ::text, because pg turns a date column into a JS Date in the local time zone
    const { rows } = await pool.query(
      `select batch_no, expiry_date::text as expiry_date from purchase_lines`,
    );
    expect(rows[0]).toEqual({ batch_no: 'B-204', expiry_date: '2027-03-31' });
  });

  it('needs a real purchase and item', async () => {
    const { branch, user, vendor, item } = await setup();
    const purchase = await insertPurchase(branch, vendor, user);
    await expect(insertLine(999999, item)).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    await expect(insertLine(purchase, 999999)).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
  });

  it('keeps its purchase: a purchase that has lines cannot be deleted', async () => {
    const { branch, user, vendor, item } = await setup();
    const purchase = await insertPurchase(branch, vendor, user);
    await insertLine(purchase, item);
    const deletion = pool.query(`delete from purchases where id = $1`, [purchase]);
    await expect(deletion).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
  });
});
