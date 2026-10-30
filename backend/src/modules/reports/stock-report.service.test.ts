// The stock and low-stock reports (Task 6.4).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb } from '../../../test/helpers/db.js';
import {
  createBranch,
  createCategory,
  createItem,
  createUser,
} from '../../../test/helpers/fixtures.js';
import { seedOpeningStock } from '../../../test/helpers/ledger.js';
import { lowStockReport, stockReport } from './stock-report.service.js';

const { db, pool } = createTestDb();

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await pool.end();
});

const PAGE = { limit: 20, offset: 0 };

/**
 * One branch with two categories:
 * - Grocery: Atta (stock 4, reorder 5: low), Rice (stock 5, reorder 5: low, exactly at it),
 *   Dal (stock 6, reorder 5: fine), Salt (stock 0, no reorder level: never low).
 * - Soap: Bath soap (stock 0, reorder 2: low), Old soap (inactive, stock 1, reorder 10).
 * - Uncategorised: Matches (stock 20, reorder 30: low).
 * Another branch has an item at 0 with a reorder level, which must never show.
 */
async function fixture() {
  const branchId = await createBranch(pool);
  const userId = await createUser(pool, { role: 'cashier' });
  const grocery = await createCategory(pool, branchId, 'Grocery');
  const soap = await createCategory(pool, branchId, 'Soap');
  const item = async (
    name: string,
    stock: number,
    options: { categoryId?: number | null; reorderLevel?: number | null; isActive?: boolean },
    inBranch = branchId,
  ) => {
    const id = await createItem(pool, inBranch, {
      code: name.toUpperCase().replace(/\s/g, ''),
      name,
      sellingPricePaise: 1000 * name.length,
      ...options,
    });
    if (stock > 0) {
      await seedOpeningStock(pool, { branchId: inBranch, itemId: id, userId, quantity: stock });
    }
    return id;
  };

  const ids = {
    atta: await item('Atta', 4, { categoryId: grocery, reorderLevel: 5 }),
    rice: await item('Rice', 5, { categoryId: grocery, reorderLevel: 5 }),
    dal: await item('Dal', 6, { categoryId: grocery, reorderLevel: 5 }),
    salt: await item('Salt', 0, { categoryId: grocery }),
    bathSoap: await item('Bath soap', 0, { categoryId: soap, reorderLevel: 2 }),
    oldSoap: await item('Old soap', 1, { categoryId: soap, reorderLevel: 10, isActive: false }),
    matches: await item('Matches', 20, { reorderLevel: 30 }),
  };
  const otherBranch = await createBranch(pool);
  await item('Elsewhere', 0, { reorderLevel: 5 }, otherBranch);
  return { branchId, grocery, soap, ids };
}

describe('stockReport', () => {
  it("lists the branch's active items by name with quantity, category and selling price", async () => {
    const f = await fixture();

    const page = await stockReport(db, { branchId: f.branchId, ...PAGE });

    expect(
      page.items.map((row) => [row.item.name, row.quantity, row.category?.name ?? null]),
    ).toEqual([
      ['Atta', 4, 'Grocery'],
      ['Bath soap', 0, 'Soap'],
      ['Dal', 6, 'Grocery'],
      ['Matches', 20, null],
      ['Rice', 5, 'Grocery'],
      ['Salt', 0, 'Grocery'],
    ]);
    expect(page.items[0]).toEqual({
      item: { id: f.ids.atta, code: 'ATTA', name: 'Atta' },
      branch: { id: f.branchId, code: expect.any(String) },
      category: { id: f.grocery, name: 'Grocery' },
      quantity: 4,
      sellingPricePaise: 4000,
      reorderLevel: 5,
    });
    expect(page).toMatchObject({ total: 6, limit: 20, offset: 0 });
  });

  it('leaves out inactive items and other branches', async () => {
    const f = await fixture();
    const names = (await stockReport(db, { branchId: f.branchId, ...PAGE })).items.map(
      (row) => row.item.name,
    );
    expect(names).not.toContain('Old soap');
    expect(names).not.toContain('Elsewhere');
  });

  it('filters by category', async () => {
    const f = await fixture();
    const page = await stockReport(db, { branchId: f.branchId, categoryId: f.soap, ...PAGE });
    expect(page.items.map((row) => row.item.name)).toEqual(['Bath soap']);
    expect(page.total).toBe(1);
  });

  it('pages in name order', async () => {
    const f = await fixture();
    const second = await stockReport(db, { branchId: f.branchId, limit: 4, offset: 4 });
    expect(second.items.map((row) => row.item.name)).toEqual(['Rice', 'Salt']);
    expect(second.total).toBe(6);
  });
});

describe('lowStockReport', () => {
  it('lists items with a reorder level and stock at or below it, the emptiest first', async () => {
    const f = await fixture();

    const page = await lowStockReport(db, { branchId: f.branchId, ...PAGE });

    expect(page.items.map((row) => [row.item.name, row.quantity, row.reorderLevel])).toEqual([
      ['Bath soap', 0, 2],
      ['Atta', 4, 5],
      ['Rice', 5, 5], // exactly at the level counts
      ['Matches', 20, 30],
    ]);
    expect(page.total).toBe(4);
  });

  it('never lists an item without a reorder level, even at 0, nor an inactive item or another branch', async () => {
    const f = await fixture();
    const names = (await lowStockReport(db, { branchId: f.branchId, ...PAGE })).items.map(
      (row) => row.item.name,
    );
    expect(names).not.toContain('Salt');
    expect(names).not.toContain('Dal');
    expect(names).not.toContain('Old soap');
    expect(names).not.toContain('Elsewhere');
  });

  it('filters by category', async () => {
    const f = await fixture();
    const page = await lowStockReport(db, { branchId: f.branchId, categoryId: f.grocery, ...PAGE });
    expect(page.items.map((row) => row.item.name)).toEqual(['Atta', 'Rice']);
  });

  it('is empty when nothing is low', async () => {
    const branchId = await createBranch(pool);
    await createItem(pool, branchId, { reorderLevel: null });
    expect(await lowStockReport(db, { branchId, ...PAGE })).toEqual({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
  });
});
