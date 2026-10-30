// The purchase register (Task 6.5): every number below is worked out by hand from the fixture.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import {
  createBranch,
  createItem,
  createUser,
  createVendor,
  mapUser,
} from '../../../test/helpers/fixtures.js';
import type { RequestContext } from '../../middleware/auth.js';
import { cancelPurchase, createPurchase, postPurchase } from '../purchases/purchases.service.js';
import { purchaseRegister } from './purchase-register.service.js';

const { db, pool } = createTestDb();

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

/** A session as the purchase service sees it. */
function contextFor(userId: number, branchId: number): RequestContext {
  return {
    user: {
      id: userId,
      username: 'u',
      fullName: 'Cashier',
      role: 'cashier',
      mustChangePassword: false,
    },
    activeBranchId: branchId,
    sessionId: 0,
    sessionToken: '',
  } as unknown as RequestContext;
}

/**
 * Purchases (invoice date, packs × cost):
 * - TPR, Arun Traders: INV-1 5 Oct 10 × ₹10 = ₹100 posted; INV-2 20 Oct 5 × ₹20 = ₹100 posted;
 *   INV-3 10 Oct 4 × ₹5 = ₹20 posted then CANCELLED; INV-4 12 Oct 3 × ₹1 DRAFT.
 * - TPR, Balaji Agencies: B-6 30 Sep ₹60 posted (before the range); B-7 31 Oct 1 × ₹70 posted
 *   (the last day); B-8 1 Nov ₹80 posted (after the range).
 * - CBE, Arun Traders (a different vendor, same name): C-1 1 Oct 2 × ₹30 = ₹60 posted (the first day).
 */
async function fixture() {
  const tpr = await createBranch(pool, { code: 'TPR' });
  const cbe = await createBranch(pool, { code: 'CBE' });
  const cashier = await createUser(pool, { role: 'cashier' });
  await mapUser(pool, cashier, tpr);
  await mapUser(pool, cashier, cbe);
  const arunTpr = await createVendor(pool, tpr, { name: 'Arun Traders' });
  const balaji = await createVendor(pool, tpr, { name: 'Balaji Agencies' });
  const arunCbe = await createVendor(pool, cbe, { name: 'Arun Traders' });
  const tprItem = await createItem(pool, tpr);
  const cbeItem = await createItem(pool, cbe);

  const enter = async (
    branchId: number,
    vendorId: number,
    vendorInvoiceNo: string,
    invoiceDate: string,
    quantity: number,
    costPricePaise: number,
    then: 'draft' | 'post' | 'cancel',
  ) => {
    const ctx = contextFor(cashier, branchId);
    const itemId = branchId === tpr ? tprItem : cbeItem;
    const draft = await createPurchase(
      db,
      ctx,
      branchId,
      { vendorId, vendorInvoiceNo, invoiceDate, lines: [{ itemId, quantity, costPricePaise }] },
      null,
    );
    if (then === 'draft') return draft.id;
    await postPurchase(db, ctx, branchId, draft.id, null);
    if (then === 'cancel') {
      await cancelPurchase(db, ctx, branchId, draft.id, { reason: 'Wrong vendor' }, null);
    }
    return draft.id;
  };

  const ids = {
    inv1: await enter(tpr, arunTpr, 'INV-1', '2026-10-05', 10, 1000, 'post'),
    inv2: await enter(tpr, arunTpr, 'INV-2', '2026-10-20', 5, 2000, 'post'),
    inv3: await enter(tpr, arunTpr, 'INV-3', '2026-10-10', 4, 500, 'cancel'),
    inv4: await enter(tpr, arunTpr, 'INV-4', '2026-10-12', 3, 100, 'draft'),
    b6: await enter(tpr, balaji, 'B-6', '2026-09-30', 1, 6000, 'post'),
    b7: await enter(tpr, balaji, 'B-7', '2026-10-31', 1, 7000, 'post'),
    b8: await enter(tpr, balaji, 'B-8', '2026-11-01', 1, 8000, 'post'),
    c1: await enter(cbe, arunCbe, 'C-1', '2026-10-01', 2, 3000, 'post'),
  };
  return { tpr, cbe, arunTpr, balaji, arunCbe, ids };
}

const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };

describe('purchaseRegister', () => {
  it('lists posted purchases in the range by vendor with subtotals; cancelled apart; drafts never', async () => {
    const f = await fixture();

    const register = await purchaseRegister(db, OCTOBER);

    expect(register).toEqual({
      ...OCTOBER,
      vendors: [
        {
          vendor: { id: f.arunCbe, name: 'Arun Traders' },
          branch: { id: f.cbe, code: 'CBE' },
          purchases: [
            { id: f.ids.c1, vendorInvoiceNo: 'C-1', invoiceDate: '2026-10-01', totalPaise: 6000 },
          ],
          subtotalPaise: 6000,
        },
        {
          vendor: { id: f.arunTpr, name: 'Arun Traders' },
          branch: { id: f.tpr, code: 'TPR' },
          purchases: [
            {
              id: f.ids.inv1,
              vendorInvoiceNo: 'INV-1',
              invoiceDate: '2026-10-05',
              totalPaise: 10000,
            },
            {
              id: f.ids.inv2,
              vendorInvoiceNo: 'INV-2',
              invoiceDate: '2026-10-20',
              totalPaise: 10000,
            },
          ],
          subtotalPaise: 20000,
        },
        {
          vendor: { id: f.balaji, name: 'Balaji Agencies' },
          branch: { id: f.tpr, code: 'TPR' },
          purchases: [
            { id: f.ids.b7, vendorInvoiceNo: 'B-7', invoiceDate: '2026-10-31', totalPaise: 7000 },
          ],
          subtotalPaise: 7000,
        },
      ],
      // ₹60 + ₹200 + ₹70; the cancelled ₹20 is not in it
      totalPaise: 33000,
      cancelled: [
        {
          id: f.ids.inv3,
          vendorInvoiceNo: 'INV-3',
          invoiceDate: '2026-10-10',
          totalPaise: 2000,
          vendor: { id: f.arunTpr, name: 'Arun Traders' },
          branch: { id: f.tpr, code: 'TPR' },
          cancelReason: 'Wrong vendor',
        },
      ],
    });
  });

  it('includes both ends of the range and nothing outside it', async () => {
    const f = await fixture();
    const register = await purchaseRegister(db, OCTOBER);
    const ids = register.vendors.flatMap((group) => group.purchases.map((purchase) => purchase.id));
    expect(ids).toContain(f.ids.c1); // 1 Oct
    expect(ids).toContain(f.ids.b7); // 31 Oct
    expect(ids).not.toContain(f.ids.b6); // 30 Sep
    expect(ids).not.toContain(f.ids.b8); // 1 Nov
  });

  it('never lists a draft, not even among the cancelled', async () => {
    const f = await fixture();
    const register = await purchaseRegister(db, { from: '2026-10-11', to: '2026-10-13' });
    expect(register).toEqual({
      from: '2026-10-11',
      to: '2026-10-13',
      vendors: [],
      totalPaise: 0,
      cancelled: [],
    });
    expect(f.ids.inv4).toBeGreaterThan(0);
  });

  it('lists a cancelled purchase even when the range has no posted one', async () => {
    const f = await fixture();
    const register = await purchaseRegister(db, { from: '2026-10-06', to: '2026-10-19' });
    expect(register.vendors).toEqual([]);
    expect(register.totalPaise).toBe(0);
    expect(register.cancelled.map((purchase) => purchase.id)).toEqual([f.ids.inv3]);
  });

  it('narrows to one branch', async () => {
    const f = await fixture();
    const register = await purchaseRegister(db, { ...OCTOBER, branchId: f.tpr });
    expect(register.vendors.map((group) => [group.vendor.id, group.subtotalPaise])).toEqual([
      [f.arunTpr, 20000],
      [f.balaji, 7000],
    ]);
    expect(register.totalPaise).toBe(27000);
    expect(register.cancelled).toHaveLength(1);

    const cbe = await purchaseRegister(db, { ...OCTOBER, branchId: f.cbe });
    expect([cbe.totalPaise, cbe.cancelled]).toEqual([6000, []]);
  });

  it('adds up: each subtotal is its purchases, and the total is the subtotals', async () => {
    await fixture();
    const register = await purchaseRegister(db, { from: '2026-09-01', to: '2026-11-30' });
    for (const group of register.vendors) {
      expect(group.subtotalPaise).toBe(
        group.purchases.reduce((sum, purchase) => sum + purchase.totalPaise, 0),
      );
    }
    expect(register.totalPaise).toBe(
      register.vendors.reduce((sum, group) => sum + group.subtotalPaise, 0),
    );
    // Every posted purchase: ₹100 + ₹100 + ₹60 + ₹70 + ₹80 + ₹60
    expect(register.totalPaise).toBe(47000);
  });
});
