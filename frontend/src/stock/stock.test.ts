import { describe, expect, it } from 'vitest';
import { isLowStock, signedQuantity } from './display';
import { stockKeys } from './keys';
import { movementsPath, STOCK_PAGE_SIZE, stockPath } from './paths';

describe('stockPath', () => {
  it('asks for the first page of every category, of the branch the person works in', () => {
    expect(STOCK_PAGE_SIZE).toBe(20);
    expect(stockPath({ branchId: null, categoryId: null }, 0)).toBe('/stock?limit=20&offset=0');
  });

  it('adds the category, the branch an Admin chose, and the page asked for', () => {
    expect(stockPath({ branchId: 4, categoryId: 3 }, 40)).toBe(
      '/stock?limit=20&offset=40&categoryId=3&branchId=4',
    );
    expect(stockPath({ branchId: 4, categoryId: null }, 0)).toBe(
      '/stock?limit=20&offset=0&branchId=4',
    );
  });
});

describe('movementsPath', () => {
  it("asks for one page of an item's history", () => {
    expect(movementsPath(7, null, 0)).toBe('/stock/7/movements?limit=20&offset=0');
    expect(movementsPath(7, 4, 20)).toBe('/stock/7/movements?limit=20&offset=20&branchId=4');
  });
});

describe('stockKeys', () => {
  it('start with "stock", so logging out or switching branch clears them (auth/cache.ts)', () => {
    const keys = [
      stockKeys.all,
      stockKeys.list({ branchId: null, categoryId: null }, 0),
      stockKeys.movements(7, null, 0),
    ];
    for (const key of keys) expect(key[0]).toBe('stock');
  });

  it('give each branch, category, item and page its own entry', () => {
    const base = stockKeys.list({ branchId: 1, categoryId: null }, 0);
    expect(stockKeys.list({ branchId: 2, categoryId: null }, 0)).not.toEqual(base);
    expect(stockKeys.list({ branchId: 1, categoryId: 5 }, 0)).not.toEqual(base);
    expect(stockKeys.list({ branchId: 1, categoryId: null }, 20)).not.toEqual(base);
    expect(stockKeys.list({ branchId: 1, categoryId: null }, 0)).toEqual(base);
    expect(stockKeys.movements(8, 1, 0)).not.toEqual(stockKeys.movements(7, 1, 0));
  });
});

describe('signedQuantity', () => {
  it.each([
    [10, '+10'],
    [1, '+1'],
    [-3, '-3'],
    [0, '0'],
  ])('writes %i as %j', (quantity, text) => {
    expect(signedQuantity(quantity)).toBe(text);
  });
});

describe('isLowStock', () => {
  it('is true at or below the reorder level', () => {
    expect(isLowStock({ quantity: 3, reorderLevel: 10 })).toBe(true);
    expect(isLowStock({ quantity: 10, reorderLevel: 10 })).toBe(true);
    expect(isLowStock({ quantity: 0, reorderLevel: 5 })).toBe(true);
  });

  it('is false above the reorder level', () => {
    expect(isLowStock({ quantity: 11, reorderLevel: 10 })).toBe(false);
  });

  it('is never true for an item without a reorder level ("no warning")', () => {
    expect(isLowStock({ quantity: 0, reorderLevel: null })).toBe(false);
    expect(isLowStock({ quantity: 50, reorderLevel: null })).toBe(false);
  });
});
