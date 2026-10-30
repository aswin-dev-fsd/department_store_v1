// Database-level rules for the billing and customer tables (Task 5.1). Raw SQL on purpose: these
// prove PostgreSQL itself enforces the rules, whatever the application code does.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb } from '../helpers/db.js';

const { db, pool } = createTestDb();

// PostgreSQL error codes
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const RESTRICT_VIOLATION = '23001';
const NOT_NULL_VIOLATION = '23502';
const INVALID_ENUM_VALUE = '22P02';

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

async function one(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(sql, params);
  return Number(rows[0]!.id);
}

async function insertBranch(code: string): Promise<number> {
  return one(
    `insert into branches (code, name, address) values ($1, 'Branch', 'Address') returning id`,
    [code],
  );
}

async function insertUser(username = 'ravi'): Promise<number> {
  return one(
    `insert into users (username, password_hash, full_name, role)
     values ($1, 'hash', 'Test User', 'cashier') returning id`,
    [username],
  );
}

async function insertItem(branchId: number): Promise<number> {
  return one(
    `insert into items (branch_id, code, name, mrp_paise, selling_price_paise)
     values ($1, 'R10', 'Rice 10 kg', 65000, 65000) returning id`,
    [branchId],
  );
}

async function insertCustomer(phone = '9876543210'): Promise<number> {
  return one(`insert into customers (phone) values ($1) returning id`, [phone]);
}

interface BillFixture {
  seq?: number;
  fy?: string;
  billNo?: string;
  customerId?: number | null;
  status?: string;
}

async function insertBill(branchId: number, cashierId: number, options: BillFixture = {}) {
  const seq = options.seq ?? 1;
  const fy = options.fy ?? '26-27';
  return one(
    `insert into bills (branch_id, fy, seq, bill_no, bill_date, cashier_id, customer_id,
                        subtotal_paise, discount_paise, round_off_paise, total_paise, status)
     values ($1, $2, $3, $4, '2026-10-30', $5, $6, 105575, 2000, 25, 103600, $7) returning id`,
    [
      branchId,
      fy,
      seq,
      options.billNo ?? `TPR/${fy}/${String(seq).padStart(6, '0')}`,
      cashierId,
      options.customerId ?? null,
      options.status ?? 'completed',
    ],
  );
}

async function insertLine(billId: number, itemId: number, { quantity = 1, discount = 0 } = {}) {
  return one(
    `insert into bill_lines (bill_id, line_no, item_id, item_name, item_code, mrp_paise,
                             unit_price_paise, quantity, discount_paise, line_total_paise)
     values ($1, 1, $2, 'Rice 10 kg', 'R10', 65000, 65000, $3, $4, $5) returning id`,
    [billId, itemId, quantity, discount, quantity * 65000 - discount],
  );
}

async function insertPayment(billId: number, mode: string, amount: number) {
  return one(
    `insert into bill_payments (bill_id, mode, amount_paise) values ($1, $2, $3) returning id`,
    [billId, mode, amount],
  );
}

/** A branch with a cashier and an item: what every bill needs. */
async function setup() {
  const branch = await insertBranch('TPR');
  const cashier = await insertUser();
  const item = await insertItem(branch);
  return { branch, cashier, item };
}

describe('billing tables exist', () => {
  it('has the five tables in the public schema', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const tables = rows.map((r) => r.table_name);
    for (const table of ['customers', 'bills', 'bill_lines', 'bill_payments', 'bill_sequences']) {
      expect(tables).toContain(table);
    }
  });

  it('defines the bill statuses and payment modes', async () => {
    const { rows } = await pool.query<{ typname: string; labels: string[] }>(
      `select t.typname, array_agg(e.enumlabel order by e.enumsortorder)::text[] as labels
         from pg_type t join pg_enum e on e.enumtypid = t.oid
        where t.typname in ('bill_status', 'payment_mode') group by t.typname order by t.typname`,
    );
    expect(rows).toEqual([
      { typname: 'bill_status', labels: ['completed', 'cancelled'] },
      { typname: 'payment_mode', labels: ['cash', 'upi', 'card'] },
    ]);
  });

  it('has the three bill indexes', async () => {
    const { rows } = await pool.query<{ indexname: string }>(
      `select indexname from pg_indexes where tablename = 'bills'`,
    );
    const names = rows.map((r) => r.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        'bills_branch_date_idx',
        'bills_cashier_date_idx',
        'bills_customer_id_idx',
      ]),
    );
  });
});

describe('customers', () => {
  it('stores a phone with an optional name', async () => {
    const id = await insertCustomer();
    const { rows } = await pool.query(`select phone, name from customers where id = $1`, [id]);
    expect(rows[0]).toEqual({ phone: '9876543210', name: null });
  });

  it('refuses the same phone twice: one customer per phone, across every branch', async () => {
    await insertCustomer('9876543210');
    await expect(insertCustomer('9876543210')).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('needs a phone', async () => {
    await expect(pool.query(`insert into customers (name) values ('Kumar')`)).rejects.toMatchObject(
      { code: NOT_NULL_VIOLATION },
    );
  });
});

describe('bills', () => {
  it('starts as completed, with the cancel fields and tax columns empty (PD-01)', async () => {
    const { branch, cashier } = await setup();
    const id = await one(
      `insert into bills (branch_id, fy, seq, bill_no, bill_date, cashier_id,
                          subtotal_paise, discount_paise, round_off_paise, total_paise)
       values ($1, '26-27', 1, 'TPR/26-27/000001', '2026-10-30', $2, 100, 0, 0, 100) returning id`,
      [branch, cashier],
    );
    const { rows } = await pool.query(
      `select status, customer_id, taxable_paise, tax_paise, cancelled_by, cancelled_at,
              cancel_reason, bill_date::text as bill_date, created_at is not null as has_created_at
         from bills where id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({
      status: 'completed',
      customer_id: null,
      taxable_paise: null,
      tax_paise: null,
      cancelled_by: null,
      cancelled_at: null,
      cancel_reason: null,
      bill_date: '2026-10-30',
      has_created_at: true,
    });
  });

  it('refuses a bill number used before, in any branch', async () => {
    const { branch, cashier } = await setup();
    const other = await insertBranch('CBE');
    await insertBill(branch, cashier, { seq: 1, billNo: 'TPR/26-27/000001' });
    await expect(
      insertBill(other, cashier, { seq: 1, billNo: 'TPR/26-27/000001' }),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('refuses the same sequence number twice in a branch and year', async () => {
    const { branch, cashier } = await setup();
    await insertBill(branch, cashier, { seq: 7, billNo: 'A' });
    await expect(insertBill(branch, cashier, { seq: 7, billNo: 'B' })).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
    });
  });

  it('allows the same sequence number in another year, and in another branch', async () => {
    const { branch, cashier } = await setup();
    const other = await insertBranch('CBE');
    await insertBill(branch, cashier, { seq: 1, fy: '26-27' });
    await insertBill(branch, cashier, { seq: 1, fy: '27-28' });
    await insertBill(other, cashier, { seq: 1, fy: '26-27', billNo: 'CBE/26-27/000001' });
  });

  it('keeps a cancelled bill under its number (status cancelled)', async () => {
    const { branch, cashier } = await setup();
    await insertBill(branch, cashier, { status: 'cancelled' });
    await expect(insertBill(branch, cashier, { status: 'void' })).rejects.toMatchObject({
      code: INVALID_ENUM_VALUE,
    });
  });

  it('needs a real branch, cashier and customer', async () => {
    const { branch, cashier } = await setup();
    await expect(insertBill(999999, cashier)).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
    await expect(insertBill(branch, 999999)).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
    await expect(insertBill(branch, cashier, { customerId: 999999 })).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
  });

  it('keeps its customer: a customer with a bill cannot be deleted', async () => {
    const { branch, cashier } = await setup();
    const customer = await insertCustomer();
    await insertBill(branch, cashier, { customerId: customer });
    await expect(
      pool.query(`delete from customers where id = $1`, [customer]),
    ).rejects.toMatchObject({ code: RESTRICT_VIOLATION });
  });
});

describe('bill_lines', () => {
  it('stores a line, with the tax columns empty (PD-01)', async () => {
    const { branch, cashier, item } = await setup();
    const bill = await insertBill(branch, cashier);
    await insertLine(bill, item, { quantity: 2, discount: 500 });
    const { rows } = await pool.query(
      `select line_no, quantity, discount_paise, line_total_paise, hsn_code, gst_rate,
              taxable_paise, cgst_paise, sgst_paise, igst_paise from bill_lines`,
    );
    expect(rows[0]).toEqual({
      line_no: 1,
      quantity: 2,
      discount_paise: '500',
      line_total_paise: '129500',
      hsn_code: null,
      gst_rate: null,
      taxable_paise: null,
      cgst_paise: null,
      sgst_paise: null,
      igst_paise: null,
    });
  });

  it.each([0, -1])('refuses a quantity of %i', async (quantity) => {
    const { branch, cashier, item } = await setup();
    const bill = await insertBill(branch, cashier);
    await expect(insertLine(bill, item, { quantity })).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    });
  });

  it('accepts no discount but refuses a negative one', async () => {
    const { branch, cashier, item } = await setup();
    const bill = await insertBill(branch, cashier);
    await insertLine(bill, item, { discount: 0 });
    await expect(insertLine(bill, item, { discount: -1 })).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    });
  });

  it('needs a real bill and item, and keeps its bill: a bill with lines cannot be deleted', async () => {
    const { branch, cashier, item } = await setup();
    const bill = await insertBill(branch, cashier);
    await expect(insertLine(999999, item)).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    await expect(insertLine(bill, 999999)).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    await insertLine(bill, item);
    await expect(pool.query(`delete from bills where id = $1`, [bill])).rejects.toMatchObject({
      code: RESTRICT_VIOLATION,
    });
  });
});

describe('bill_payments', () => {
  it('stores a split payment, one row per mode', async () => {
    const { branch, cashier } = await setup();
    const bill = await insertBill(branch, cashier);
    await insertPayment(bill, 'cash', 50000);
    await insertPayment(bill, 'upi', 53600);
    const { rows } = await pool.query(
      `select mode, amount_paise::int as amount from bill_payments order by id`,
    );
    expect(rows).toEqual([
      { mode: 'cash', amount: 50000 },
      { mode: 'upi', amount: 53600 },
    ]);
  });

  it.each([0, -100])('refuses an amount of %i', async (amount) => {
    const { branch, cashier } = await setup();
    const bill = await insertBill(branch, cashier);
    await expect(insertPayment(bill, 'cash', amount)).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    });
  });

  it('refuses an unknown mode', async () => {
    const { branch, cashier } = await setup();
    const bill = await insertBill(branch, cashier);
    await expect(insertPayment(bill, 'cheque', 100)).rejects.toMatchObject({
      code: INVALID_ENUM_VALUE,
    });
  });
});

describe('bill_sequences', () => {
  it('holds one row per branch and year', async () => {
    const branch = await insertBranch('TPR');
    await pool.query(
      `insert into bill_sequences (branch_id, fy, last_seq) values ($1, '26-27', 0)`,
      [branch],
    );
    await pool.query(
      `insert into bill_sequences (branch_id, fy, last_seq) values ($1, '27-28', 0)`,
      [branch],
    );
    await expect(
      pool.query(`insert into bill_sequences (branch_id, fy, last_seq) values ($1, '26-27', 5)`, [
        branch,
      ]),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('takes the next number in one statement, as Task 5.3 will', async () => {
    const branch = await insertBranch('TPR');
    const next = async () => {
      const { rows } = await pool.query<{ last_seq: number }>(
        `insert into bill_sequences (branch_id, fy, last_seq) values ($1, '26-27', 1)
         on conflict (branch_id, fy) do update set last_seq = bill_sequences.last_seq + 1
         returning last_seq`,
        [branch],
      );
      return rows[0]!.last_seq;
    };
    expect([await next(), await next(), await next()]).toEqual([1, 2, 3]);
  });

  it('needs a real branch', async () => {
    await expect(
      pool.query(
        `insert into bill_sequences (branch_id, fy, last_seq) values (999999, '26-27', 0)`,
      ),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
  });
});
