// Draft purchases (Task 4.2): create, edit, list and view. Drafts never touch stock.
import { schema } from '@ds/database';
import { PURCHASE_STATUSES } from '@ds/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { expectAudit } from '../../../test/helpers/audit.js';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import {
  cookieFor,
  createBranch,
  createItem,
  createUser,
  createVendor,
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
const URL = '/api/v1/purchases';

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
  vendorId: number;
  rice: number;
  dal: number;
}

/** A cashier working in a new branch that has a vendor and two items. */
async function counter(): Promise<Counter> {
  const branchId = await createBranch(pool);
  const userId = await createUser(pool, { role: 'cashier', fullName: 'Ravi Kumar' });
  await mapUser(pool, userId, branchId);
  const vendorId = await createVendor(pool, branchId, { name: 'Sri Traders' });
  const rice = await createItem(pool, branchId, { code: 'R10', name: 'Rice 10 kg' });
  const dal = await createItem(pool, branchId, { code: 'D1', name: 'Toor Dal 1 kg' });
  return { userId, branchId, cookie: await cookieFor(db, userId, branchId), vendorId, rice, dal };
}

async function adminCookie(): Promise<string> {
  return cookieFor(db, await createUser(pool, { role: 'admin' }));
}

type Body = Record<string, unknown>;

/** The body of a valid draft; override what a test is about. */
function body(vendorId: number, lines: Body[] = [], overrides: Body = {}): Body {
  return {
    vendorId,
    vendorInvoiceNo: 'INV-2231',
    invoiceDate: '2026-10-28',
    lines,
    ...overrides,
  };
}

function line(itemId: number, quantity: number, costPricePaise: number, extra: Body = {}): Body {
  return { itemId, quantity, costPricePaise, ...extra };
}

async function createDraft(c: Counter, payload: Body) {
  return request(app).post(URL).set('Cookie', c.cookie).send(payload);
}

async function editDraft(c: Counter, id: number, payload: Body) {
  return request(app).put(`${URL}/${id}`).set('Cookie', c.cookie).send(payload);
}

/** Create a draft through the API and return its id. */
async function draftId(c: Counter, payload: Body): Promise<number> {
  const res = await createDraft(c, payload);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id as number;
}

/** Move a purchase to another status directly, as posting and cancelling (Tasks 4.3, 4.4) will. */
async function setStatus(id: number, status: 'posted' | 'cancelled'): Promise<void> {
  await pool.query(`update purchases set status = $2 where id = $1`, [id, status]);
}

/** A purchase header straight from the database. */
async function storedPurchase(id: number) {
  const { rows } = await pool.query(
    `select branch_id, vendor_id, vendor_invoice_no, invoice_date::text as invoice_date, status,
            total_paise, notes, created_by, posted_by, cancelled_by, updated_at::text as updated_at
       from purchases where id = $1`,
    [id],
  );
  const row = rows[0];
  return {
    branchId: Number(row.branch_id),
    vendorId: Number(row.vendor_id),
    vendorInvoiceNo: row.vendor_invoice_no as string,
    invoiceDate: row.invoice_date as string,
    status: row.status as string,
    totalPaise: Number(row.total_paise),
    notes: row.notes as string | null,
    createdBy: Number(row.created_by),
    postedBy: row.posted_by,
    cancelledBy: row.cancelled_by,
    updatedAt: row.updated_at as string,
  };
}

/** A purchase's lines straight from the database, in entry order. */
async function storedLines(purchaseId: number) {
  const { rows } = await pool.query(
    `select id, item_id, quantity, cost_price_paise, new_mrp_paise, new_selling_price_paise,
            batch_no, expiry_date, line_total_paise
       from purchase_lines where purchase_id = $1 order by id`,
    [purchaseId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    itemId: Number(row.item_id),
    quantity: Number(row.quantity),
    costPricePaise: Number(row.cost_price_paise),
    newMrpPaise: row.new_mrp_paise === null ? null : Number(row.new_mrp_paise),
    newSellingPricePaise:
      row.new_selling_price_paise === null ? null : Number(row.new_selling_price_paise),
    batchNo: row.batch_no as string | null,
    expiryDate: row.expiry_date as unknown,
    lineTotalPaise: Number(row.line_total_paise),
  }));
}

async function purchaseCount(): Promise<number> {
  const { rows } = await pool.query('select count(*)::int as n from purchases');
  return rows[0].n as number;
}

async function auditCount(action: string): Promise<number> {
  const { rows } = await pool.query('select 1 from audit_logs where action = $1', [action]);
  return rows.length;
}

describe('access control', () => {
  it.each([
    ['GET', URL],
    ['GET', `${URL}/1`],
    ['POST', URL],
    ['PUT', `${URL}/1`],
  ] as const)('%s %s answers 401 without a session', async (method, path) => {
    const agent = request(app);
    const res =
      method === 'GET'
        ? await agent.get(path)
        : method === 'POST'
          ? await agent.post(path)
          : await agent.put(path);
    expect(res.status).toBe(401);
  });

  it('refuses an Admin on every route with 403 FORBIDDEN, and changes nothing', async () => {
    const c = await counter();
    const id = await draftId(c, body(c.vendorId, [line(c.rice, 10, 45000)]));
    const cookie = await adminCookie();

    const responses = [
      await request(app).get(URL).set('Cookie', cookie),
      await request(app).get(`${URL}/${id}`).set('Cookie', cookie),
      await request(app)
        .post(URL)
        .set('Cookie', cookie)
        .send(body(c.vendorId, [], { vendorInvoiceNo: 'X' })),
      await request(app)
        .put(`${URL}/${id}`)
        .set('Cookie', cookie)
        .send(body(c.vendorId, [], { vendorInvoiceNo: 'HACKED' })),
    ];

    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(await purchaseCount()).toBe(1);
    expect(await storedPurchase(id)).toMatchObject({ vendorInvoiceNo: 'INV-2231' });
    expect(await storedLines(id)).toHaveLength(1);
  });

  it('asks a cashier without a chosen branch to choose one (403 NO_ACTIVE_BRANCH) on every route', async () => {
    const userId = await createUser(pool, { role: 'cashier' });
    const cookie = await cookieFor(db, userId, null);

    const responses = [
      await request(app).get(URL).set('Cookie', cookie),
      await request(app).get(`${URL}/1`).set('Cookie', cookie),
      await request(app).post(URL).set('Cookie', cookie).send(body(1)),
      await request(app).put(`${URL}/1`).set('Cookie', cookie).send(body(1)),
    ];

    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('NO_ACTIVE_BRANCH');
    }
  });
});

describe('purchase statuses', () => {
  it('match the database enum', () => {
    expect([...PURCHASE_STATUSES]).toEqual(schema.purchaseStatus.enumValues);
  });
});

describe('POST /purchases', () => {
  it('creates a draft in the active branch, computes every total, and audits it', async () => {
    const c = await counter();
    const res = await createDraft(
      c,
      body(c.vendorId, [line(c.rice, 12, 45000), line(c.dal, 3, 11999)], { notes: 'Two cartons' }),
    );

    expect(res.status).toBe(201);
    const id = res.body.data.id as number;
    // 12 × 45000 + 3 × 11999
    const total = 540000 + 35997;
    expect(res.body.data).toMatchObject({
      id,
      vendor: { id: c.vendorId, name: 'Sri Traders' },
      vendorInvoiceNo: 'INV-2231',
      invoiceDate: '2026-10-28',
      status: 'draft',
      totalPaise: total,
      notes: 'Two cartons',
      createdBy: { id: c.userId, fullName: 'Ravi Kumar' },
      postedBy: null,
      postedAt: null,
      cancelledBy: null,
      cancelledAt: null,
      cancelReason: null,
      lines: [
        {
          itemId: c.rice,
          itemCode: 'R10',
          itemName: 'Rice 10 kg',
          quantity: 12,
          costPricePaise: 45000,
          newMrpPaise: null,
          newSellingPricePaise: null,
          lineTotalPaise: 540000,
        },
        { itemId: c.dal, itemCode: 'D1', quantity: 3, lineTotalPaise: 35997 },
      ],
    });

    expect(await storedPurchase(id)).toMatchObject({
      branchId: c.branchId,
      vendorId: c.vendorId,
      status: 'draft',
      totalPaise: total,
      createdBy: c.userId,
      postedBy: null,
      cancelledBy: null,
    });
    expect((await storedLines(id)).map((l) => l.lineTotalPaise)).toEqual([540000, 35997]);

    const audit = await expectAudit(db, {
      action: 'purchase.create',
      entity: 'purchase',
      entityId: id,
      actorId: c.userId,
    });
    expect(audit.branchId).toBe(c.branchId);
    expect(audit.before).toBeNull();
    expect(audit.after).toEqual({
      vendorId: c.vendorId,
      vendorInvoiceNo: 'INV-2231',
      invoiceDate: '2026-10-28',
      notes: 'Two cartons',
      totalPaise: total,
      status: 'draft',
      lines: [
        {
          itemId: c.rice,
          quantity: 12,
          costPricePaise: 45000,
          newMrpPaise: null,
          newSellingPricePaise: null,
          lineTotalPaise: 540000,
        },
        {
          itemId: c.dal,
          quantity: 3,
          costPricePaise: 11999,
          newMrpPaise: null,
          newSellingPricePaise: null,
          lineTotalPaise: 35997,
        },
      ],
    });
  });

  it('saves a draft with no lines yet, at a total of 0 (an invoice entered part-way)', async () => {
    const c = await counter();
    const res = await createDraft(c, body(c.vendorId));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'draft', totalPaise: 0, lines: [] });
    expect(await storedLines(res.body.data.id)).toEqual([]);
  });

  it('ignores totals and a status sent by the client, and batch and expiry (PD-02)', async () => {
    const c = await counter();
    const res = await createDraft(
      c,
      body(
        c.vendorId,
        [line(c.rice, 2, 1000, { lineTotalPaise: 1, batchNo: 'B-1', expiryDate: '2027-01-31' })],
        { totalPaise: 1, status: 'posted', postedBy: c.userId },
      ),
    );

    expect(res.status).toBe(201);
    const id = res.body.data.id as number;
    expect(await storedPurchase(id)).toMatchObject({
      status: 'draft',
      totalPaise: 2000,
      postedBy: null,
    });
    expect(await storedLines(id)).toMatchObject([
      { lineTotalPaise: 2000, batchNo: null, expiryDate: null },
    ]);
  });

  it('keeps new prices given on a line, for posting to apply later', async () => {
    const c = await counter();
    const res = await createDraft(
      c,
      body(c.vendorId, [
        line(c.rice, 1, 45000, { newMrpPaise: 52000, newSellingPricePaise: 50000 }),
      ]),
    );
    expect(res.status).toBe(201);
    expect(await storedLines(res.body.data.id)).toMatchObject([
      { newMrpPaise: 52000, newSellingPricePaise: 50000 },
    ]);
    // Prices change only when the purchase is posted (Task 4.3)
    const { rows } = await pool.query('select mrp_paise from items where id = $1', [c.rice]);
    expect(Number(rows[0].mrp_paise)).toBe(10000);
  });

  it('allows the same item on two lines, as an invoice may list it twice', async () => {
    const c = await counter();
    const res = await createDraft(
      c,
      body(c.vendorId, [line(c.rice, 5, 45000), line(c.rice, 1, 0)]),
    );
    expect(res.status).toBe(201);
    expect(res.body.data.totalPaise).toBe(225000);
    expect(res.body.data.lines).toHaveLength(2);
  });

  it('trims the invoice number and keeps its case', async () => {
    const c = await counter();
    const res = await createDraft(c, body(c.vendorId, [], { vendorInvoiceNo: '  inv/77 ' }));
    expect(res.status).toBe(201);
    expect(res.body.data.vendorInvoiceNo).toBe('inv/77');
  });
});

describe('duplicate vendor invoices', () => {
  it('refuses the same vendor invoice again in the branch, in any letter case, and saves nothing', async () => {
    const c = await counter();
    await draftId(c, body(c.vendorId, [], { vendorInvoiceNo: 'INV-2231' }));

    const res = await createDraft(
      c,
      body(c.vendorId, [line(c.rice, 1, 100)], { vendorInvoiceNo: 'inv-2231' }),
    );

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DUPLICATE_INVOICE');
    expect(await purchaseCount()).toBe(1);
    expect(await auditCount('purchase.create')).toBe(1);
  });

  it('refuses it while the earlier one is posted', async () => {
    const c = await counter();
    const first = await draftId(c, body(c.vendorId));
    await setStatus(first, 'posted');

    const res = await createDraft(c, body(c.vendorId));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DUPLICATE_INVOICE');
  });

  it('allows it again once the earlier one is cancelled (re-entry after a cancel)', async () => {
    const c = await counter();
    const first = await draftId(c, body(c.vendorId));
    await setStatus(first, 'cancelled');

    const res = await createDraft(c, body(c.vendorId));
    expect(res.status).toBe(201);
    expect(res.body.data.id).not.toBe(first);
  });

  it('allows the same number from another vendor, and in another branch', async () => {
    const c = await counter();
    const other = await counter();
    const secondVendor = await createVendor(pool, c.branchId, { name: 'Kovai Wholesale' });
    await draftId(c, body(c.vendorId));

    expect((await createDraft(c, body(secondVendor))).status).toBe(201);
    expect((await createDraft(other, body(other.vendorId))).status).toBe(201);
  });

  it('refuses an edit to an invoice number already entered, and leaves the draft as it was', async () => {
    const c = await counter();
    await draftId(c, body(c.vendorId, [], { vendorInvoiceNo: 'INV-1' }));
    const id = await draftId(
      c,
      body(c.vendorId, [line(c.rice, 1, 100)], { vendorInvoiceNo: 'INV-2' }),
    );

    const res = await editDraft(
      c,
      id,
      body(c.vendorId, [line(c.dal, 9, 900)], { vendorInvoiceNo: 'Inv-1' }),
    );

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DUPLICATE_INVOICE');
    expect(await storedPurchase(id)).toMatchObject({ vendorInvoiceNo: 'INV-2', totalPaise: 100 });
    expect(await storedLines(id)).toMatchObject([{ itemId: c.rice, quantity: 1 }]);
    expect(await auditCount('purchase.update')).toBe(0);
  });
});

describe('validation', () => {
  it('refuses an inactive vendor with 422 on the vendor, and saves nothing', async () => {
    const c = await counter();
    const inactive = await createVendor(pool, c.branchId, { isActive: false });

    const res = await createDraft(c, body(inactive, [line(c.rice, 1, 100)]));

    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([
      { path: 'body.vendorId', message: "Choose one of this branch's active vendors" },
    ]);
    expect(await purchaseCount()).toBe(0);
    expect(await auditCount('purchase.create')).toBe(0);
  });

  it("refuses another branch's vendor, and one that does not exist", async () => {
    const c = await counter();
    const other = await counter();

    for (const vendorId of [other.vendorId, 999999]) {
      const res = await createDraft(c, body(vendorId));
      expect(res.status).toBe(422);
      expect(res.body.error.details[0].path).toBe('body.vendorId');
    }
    expect(await purchaseCount()).toBe(0);
  });

  it("refuses an inactive item, another branch's and a missing one, naming every line at fault", async () => {
    const c = await counter();
    const other = await counter();
    const inactive = await createItem(pool, c.branchId, { isActive: false });

    const res = await createDraft(
      c,
      body(c.vendorId, [
        line(c.rice, 1, 100),
        line(inactive, 1, 100),
        line(other.rice, 1, 100),
        line(999999, 1, 100),
      ]),
    );

    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual([
      'body.lines.1.itemId',
      'body.lines.2.itemId',
      'body.lines.3.itemId',
    ]);
    expect(await purchaseCount()).toBe(0);
  });

  it.each([
    ['a quantity of 0', { quantity: 0 }, 'body.lines.0.quantity'],
    ['a negative cost price', { costPricePaise: -1 }, 'body.lines.0.costPricePaise'],
  ])('refuses a line with %s (422)', async (_label, overrides, path) => {
    const c = await counter();
    const res = await createDraft(c, body(c.vendorId, [line(c.rice, 1, 100, overrides)]));
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].path).toBe(path);
    expect(await purchaseCount()).toBe(0);
  });

  it('refuses a missing invoice number or a date that does not exist (422)', async () => {
    const c = await counter();
    const missing = await createDraft(c, body(c.vendorId, [], { vendorInvoiceNo: '' }));
    const badDate = await createDraft(c, body(c.vendorId, [], { invoiceDate: '2026-02-30' }));
    expect(missing.status).toBe(422);
    expect(missing.body.error.details[0].path).toBe('body.vendorInvoiceNo');
    expect(badDate.status).toBe(422);
    expect(badDate.body.error.details[0].path).toBe('body.invoiceDate');
  });

  it('checks the vendor and items again on every edit: an item deactivated since is refused', async () => {
    const c = await counter();
    const id = await draftId(c, body(c.vendorId, [line(c.rice, 1, 100)]));
    await pool.query('update items set is_active = false where id = $1', [c.rice]);

    const res = await editDraft(c, id, body(c.vendorId, [line(c.rice, 2, 100)]));

    expect(res.status).toBe(422);
    expect(res.body.error.details[0].path).toBe('body.lines.0.itemId');
    expect(await storedLines(id)).toMatchObject([{ quantity: 1 }]);
  });
});

describe('PUT /purchases/:id', () => {
  it('replaces the header and all the lines of a draft, recomputes the total, and audits what changed', async () => {
    const c = await counter();
    const secondVendor = await createVendor(pool, c.branchId, { name: 'Kovai Wholesale' });
    const id = await draftId(
      c,
      body(c.vendorId, [line(c.rice, 10, 45000), line(c.dal, 2, 12000)], { notes: 'Part 1' }),
    );
    const oldLineIds = (await storedLines(id)).map((l) => l.id);

    const res = await editDraft(
      c,
      id,
      body(secondVendor, [line(c.dal, 5, 11000, { newSellingPricePaise: 13000 })], {
        vendorInvoiceNo: 'KW-9',
        invoiceDate: '2026-10-29',
        notes: 'Part 1',
      }),
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id,
      vendor: { id: secondVendor, name: 'Kovai Wholesale' },
      vendorInvoiceNo: 'KW-9',
      invoiceDate: '2026-10-29',
      status: 'draft',
      totalPaise: 55000,
      lines: [{ itemId: c.dal, quantity: 5, newSellingPricePaise: 13000, lineTotalPaise: 55000 }],
    });
    const lines = await storedLines(id);
    expect(lines).toHaveLength(1);
    expect(oldLineIds).not.toContain(lines[0]!.id);

    const audit = await expectAudit(db, {
      action: 'purchase.update',
      entity: 'purchase',
      entityId: id,
      actorId: c.userId,
    });
    // notes did not change, so they are not recorded
    expect(audit.before).toEqual({
      vendorId: c.vendorId,
      vendorInvoiceNo: 'INV-2231',
      invoiceDate: '2026-10-28',
      totalPaise: 474000,
      lines: [
        {
          itemId: c.rice,
          quantity: 10,
          costPricePaise: 45000,
          newMrpPaise: null,
          newSellingPricePaise: null,
          lineTotalPaise: 450000,
        },
        {
          itemId: c.dal,
          quantity: 2,
          costPricePaise: 12000,
          newMrpPaise: null,
          newSellingPricePaise: null,
          lineTotalPaise: 24000,
        },
      ],
    });
    expect(audit.after).toEqual({
      vendorId: secondVendor,
      vendorInvoiceNo: 'KW-9',
      invoiceDate: '2026-10-29',
      totalPaise: 55000,
      lines: [
        {
          itemId: c.dal,
          quantity: 5,
          costPricePaise: 11000,
          newMrpPaise: null,
          newSellingPricePaise: 13000,
          lineTotalPaise: 55000,
        },
      ],
    });
  });

  it('keeps the lines as they are when only the header changes, and audits the header only', async () => {
    const c = await counter();
    const lines = [line(c.rice, 10, 45000)];
    const id = await draftId(c, body(c.vendorId, lines));
    const lineIds = (await storedLines(id)).map((l) => l.id);

    const res = await editDraft(c, id, body(c.vendorId, lines, { notes: 'Checked' }));

    expect(res.status).toBe(200);
    expect((await storedLines(id)).map((l) => l.id)).toEqual(lineIds);
    const audit = await expectAudit(db, { action: 'purchase.update', entityId: id });
    expect(audit.before).toEqual({ notes: null });
    expect(audit.after).toEqual({ notes: 'Checked' });
  });

  it('records the lines, but not the header, when only a line changes', async () => {
    const c = await counter();
    const id = await draftId(c, body(c.vendorId, [line(c.rice, 10, 0)]));

    // A free item (cost 0) with a new quantity: the total stays 0, only the line changes
    const res = await editDraft(c, id, body(c.vendorId, [line(c.rice, 11, 0)]));

    expect(res.status).toBe(200);
    const audit = await expectAudit(db, { action: 'purchase.update', entityId: id });
    expect(Object.keys(audit.after as object)).toEqual(['lines']);
    expect((await storedPurchase(id)).totalPaise).toBe(0);
  });

  it('does nothing, and records nothing, when nothing really changes', async () => {
    const c = await counter();
    const payload = body(c.vendorId, [line(c.rice, 10, 45000)], { notes: 'Same' });
    const id = await draftId(c, payload);
    const before = await storedPurchase(id);
    const lineIds = (await storedLines(id)).map((l) => l.id);

    const res = await editDraft(c, id, payload);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id, totalPaise: 450000 });
    expect(await storedPurchase(id)).toEqual(before);
    expect((await storedLines(id)).map((l) => l.id)).toEqual(lineIds);
    expect(await auditCount('purchase.update')).toBe(0);
  });

  it('clears the notes when they are left out, and every line when none are sent: the whole draft is replaced', async () => {
    const c = await counter();
    const id = await draftId(c, body(c.vendorId, [line(c.rice, 10, 45000)], { notes: 'Old' }));

    const { lines: _lines, ...withoutLines } = body(c.vendorId);
    const res = await editDraft(c, id, withoutLines);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ notes: null, totalPaise: 0, lines: [] });
    expect(await storedLines(id)).toEqual([]);
  });

  it.each(['posted', 'cancelled'] as const)(
    'refuses to edit a %s purchase with 400 DOCUMENT_LOCKED, and changes nothing',
    async (status) => {
      const c = await counter();
      const id = await draftId(c, body(c.vendorId, [line(c.rice, 10, 45000)]));
      await setStatus(id, status);
      const before = await storedPurchase(id);

      const res = await editDraft(c, id, body(c.vendorId, [], { vendorInvoiceNo: 'NEW' }));

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('DOCUMENT_LOCKED');
      expect(await storedPurchase(id)).toEqual(before);
      expect(await storedLines(id)).toHaveLength(1);
      expect(await auditCount('purchase.update')).toBe(0);
    },
  );

  it("answers 404 for another branch's purchase and changes nothing (branch isolation)", async () => {
    const c = await counter();
    const other = await counter();
    const id = await draftId(other, body(other.vendorId, [line(other.rice, 1, 100)]));

    const res = await editDraft(c, id, body(c.vendorId, [], { vendorInvoiceNo: 'MINE' }));

    expect(res.status).toBe(404);
    expect(await storedPurchase(id)).toMatchObject({
      branchId: other.branchId,
      vendorInvoiceNo: 'INV-2231',
    });
    expect(await storedLines(id)).toHaveLength(1);
  });

  it('answers 404 for a purchase that does not exist, and 422 for an id that is not one', async () => {
    const c = await counter();
    expect((await editDraft(c, 999999, body(c.vendorId))).status).toBe(404);
    expect((await editDraft(c, 0, body(c.vendorId))).status).toBe(422);
  });
});

describe('GET /purchases/:id', () => {
  it('shows the purchase with its lines in the order entered, with item codes and names', async () => {
    const c = await counter();
    const id = await draftId(c, body(c.vendorId, [line(c.dal, 1, 100), line(c.rice, 2, 200)]));

    const res = await request(app).get(`${URL}/${id}`).set('Cookie', c.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id,
      vendor: { id: c.vendorId, name: 'Sri Traders' },
      status: 'draft',
      totalPaise: 500,
      createdBy: { id: c.userId, fullName: 'Ravi Kumar' },
      postedBy: null,
      cancelledBy: null,
      lines: [
        { itemId: c.dal, itemCode: 'D1', itemName: 'Toor Dal 1 kg', quantity: 1 },
        { itemId: c.rice, itemCode: 'R10', itemName: 'Rice 10 kg', quantity: 2 },
      ],
    });
    expect(typeof res.body.data.createdAt).toBe('string');
  });

  it("answers 404 for another branch's purchase, and for one that does not exist", async () => {
    const c = await counter();
    const other = await counter();
    const id = await draftId(other, body(other.vendorId));

    expect((await request(app).get(`${URL}/${id}`).set('Cookie', c.cookie)).status).toBe(404);
    expect((await request(app).get(`${URL}/999999`).set('Cookie', c.cookie)).status).toBe(404);
  });
});

describe('GET /purchases', () => {
  /** Three purchases of the branch over three dates and two vendors, one of them posted. */
  async function threePurchases(c: Counter) {
    const kovai = await createVendor(pool, c.branchId, { name: 'Kovai Wholesale' });
    const early = await draftId(
      c,
      body(c.vendorId, [], { vendorInvoiceNo: 'A-1', invoiceDate: '2026-10-01' }),
    );
    const middle = await draftId(
      c,
      body(kovai, [line(c.rice, 1, 100)], { vendorInvoiceNo: 'B-1', invoiceDate: '2026-10-15' }),
    );
    const late = await draftId(
      c,
      body(c.vendorId, [], { vendorInvoiceNo: 'A-2', invoiceDate: '2026-10-31' }),
    );
    await setStatus(middle, 'posted');
    return { kovai, early, middle, late };
  }

  async function list(c: Counter, query = '') {
    const res = await request(app).get(`${URL}${query}`).set('Cookie', c.cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as {
      items: { id: number }[];
      total: number;
      limit: number;
      offset: number;
    };
  }

  it("lists the branch's purchases, newest invoice date first, and never another branch's", async () => {
    const c = await counter();
    const other = await counter();
    const { kovai, early, middle, late } = await threePurchases(c);
    await draftId(other, body(other.vendorId));

    const page = await list(c);

    expect(page).toMatchObject({ total: 3, limit: 20, offset: 0 });
    expect(page.items.map((p) => p.id)).toEqual([late, middle, early]);
    expect(page.items[1]).toEqual({
      id: middle,
      vendor: { id: kovai, name: 'Kovai Wholesale' },
      vendorInvoiceNo: 'B-1',
      invoiceDate: '2026-10-15',
      status: 'posted',
      totalPaise: 100,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('orders purchases of the same date newest first', async () => {
    const c = await counter();
    const first = await draftId(c, body(c.vendorId, [], { vendorInvoiceNo: 'X-1' }));
    const second = await draftId(c, body(c.vendorId, [], { vendorInvoiceNo: 'X-2' }));
    expect((await list(c)).items.map((p) => p.id)).toEqual([second, first]);
  });

  it('filters by status', async () => {
    const c = await counter();
    const { early, middle, late } = await threePurchases(c);
    expect((await list(c, '?status=draft')).items.map((p) => p.id)).toEqual([late, early]);
    expect((await list(c, '?status=posted')).items.map((p) => p.id)).toEqual([middle]);
    expect((await list(c, '?status=cancelled')).items).toEqual([]);
  });

  it('filters by vendor', async () => {
    const c = await counter();
    const { kovai, early, middle, late } = await threePurchases(c);
    expect((await list(c, `?vendorId=${c.vendorId}`)).items.map((p) => p.id)).toEqual([
      late,
      early,
    ]);
    expect((await list(c, `?vendorId=${kovai}`)).items.map((p) => p.id)).toEqual([middle]);
  });

  it('filters by invoice date range, both ends included', async () => {
    const c = await counter();
    const { early, middle, late } = await threePurchases(c);
    expect((await list(c, '?from=2026-10-15')).items.map((p) => p.id)).toEqual([late, middle]);
    expect((await list(c, '?to=2026-10-15')).items.map((p) => p.id)).toEqual([middle, early]);
    expect((await list(c, '?from=2026-10-15&to=2026-10-15')).items.map((p) => p.id)).toEqual([
      middle,
    ]);
  });

  it('combines the filters', async () => {
    const c = await counter();
    const { late } = await threePurchases(c);
    const page = await list(c, `?status=draft&vendorId=${c.vendorId}&from=2026-10-02`);
    expect(page.items.map((p) => p.id)).toEqual([late]);
    expect(page.total).toBe(1);
  });

  it('pages with limit and offset, keeping the total', async () => {
    const c = await counter();
    const { early, middle } = await threePurchases(c);
    const page = await list(c, '?limit=2&offset=1');
    expect(page).toMatchObject({ total: 3, limit: 2, offset: 1 });
    expect(page.items.map((p) => p.id)).toEqual([middle, early]);
  });

  it('refuses an end date before the start date (422)', async () => {
    const c = await counter();
    const res = await request(app)
      .get(`${URL}?from=2026-10-31&to=2026-10-01`)
      .set('Cookie', c.cookie);
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].path).toBe('query.to');
  });
});

describe('no stock effect', () => {
  it('leaves stock and the ledger untouched through create, edit, list and view', async () => {
    const c = await counter();
    await seedOpeningStock(pool, {
      branchId: c.branchId,
      itemId: c.rice,
      userId: c.userId,
      quantity: 7,
    });

    const id = await draftId(c, body(c.vendorId, [line(c.rice, 24, 45000), line(c.dal, 5, 100)]));
    expect(
      (await editDraft(c, id, body(c.vendorId, [line(c.rice, 30, 45000), line(c.dal, 6, 100)])))
        .status,
    ).toBe(200);
    expect((await request(app).get(URL).set('Cookie', c.cookie)).status).toBe(200);
    expect((await request(app).get(`${URL}/${id}`).set('Cookie', c.cookie)).status).toBe(200);

    expect(await stockOf(pool, c.rice)).toBe(7);
    expect(await stockOf(pool, c.dal)).toBe(0);
    expect(await movementCount(pool, c.rice)).toBe(1);
    expect(await movementCount(pool, c.dal)).toBe(0);
    await assertLedgerMatchesStock(pool, c.rice);
    await assertLedgerMatchesStock(pool, c.dal);
  });
});
