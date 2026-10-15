import { describe, expect, it } from 'vitest';
import {
  ADJUSTMENT_REASONS,
  itemIdParamSchema,
  listMovementsQuerySchema,
  listStockQuerySchema,
  MOVEMENT_REF_TYPES,
  MOVEMENT_TYPES,
} from './stock.js';

describe('the ledger vocabularies', () => {
  it('list every movement type, reference type and adjustment reason', () => {
    expect([...MOVEMENT_TYPES]).toEqual([
      'opening',
      'purchase',
      'purchase_cancel',
      'sale',
      'sale_cancel',
      'adjustment',
    ]);
    expect([...MOVEMENT_REF_TYPES]).toEqual(['bill', 'purchase', 'adjustment', 'import']);
    expect([...ADJUSTMENT_REASONS]).toEqual([
      'damage',
      'expiry',
      'theft',
      'count_correction',
      'other',
    ]);
  });
});

describe('itemIdParamSchema', () => {
  it('takes a positive whole number from the URL', () => {
    expect(itemIdParamSchema.parse({ itemId: '12' })).toEqual({ itemId: 12 });
  });

  it.each(['abc', '0', '1.5', '-1', '', '1e3', ' 5'])('refuses %j', (itemId) => {
    expect(itemIdParamSchema.safeParse({ itemId }).success).toBe(false);
  });

  it('needs the id', () => {
    expect(itemIdParamSchema.safeParse({}).success).toBe(false);
  });
});

describe('listStockQuerySchema', () => {
  it('is the standard paging query with no filters by default', () => {
    expect(listStockQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
  });

  it('takes the category and the branch as positive whole numbers', () => {
    expect(
      listStockQuerySchema.parse({ categoryId: '7', branchId: '3', limit: '50', offset: '10' }),
    ).toEqual({ limit: 50, offset: 10, categoryId: 7, branchId: 3 });
  });

  it.each([
    { categoryId: 'abc' },
    { categoryId: '0' },
    { branchId: 'abc' },
    { branchId: '0' },
    { branchId: '1.5' },
    { limit: '101' },
    { limit: '0' },
    { offset: '-1' },
  ])('refuses %j', (query) => {
    expect(listStockQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('listMovementsQuerySchema', () => {
  it('is the standard paging query, with the branch for the Admin', () => {
    expect(listMovementsQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
    expect(listMovementsQuerySchema.parse({ branchId: '3', limit: '5' })).toEqual({
      limit: 5,
      offset: 0,
      branchId: 3,
    });
  });

  it('has no category filter: it is ignored', () => {
    expect(listMovementsQuerySchema.parse({ categoryId: '7' })).toEqual({ limit: 20, offset: 0 });
  });

  it.each([{ branchId: 'abc' }, { branchId: '0' }, { limit: '101' }, { offset: '-1' }])(
    'refuses %j',
    (query) => {
      expect(listMovementsQuerySchema.safeParse(query).success).toBe(false);
    },
  );
});
