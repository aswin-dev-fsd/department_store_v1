import { describe, expect, it } from 'vitest';
import {
  categoryNameSchema,
  createCategorySchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
} from './categories.js';

describe('categoryNameSchema', () => {
  it('trims the name and keeps its case and any script', () => {
    expect(categoryNameSchema.parse('  Grocery ')).toBe('Grocery');
    expect(categoryNameSchema.parse('மளிகை')).toBe('மளிகை');
  });

  it('refuses a blank name', () => {
    expect(categoryNameSchema.safeParse('').success).toBe(false);
    expect(categoryNameSchema.safeParse('   ').success).toBe(false);
  });

  it('allows up to 100 characters and refuses more', () => {
    expect(categoryNameSchema.safeParse('a'.repeat(100)).success).toBe(true);
    const tooLong = categoryNameSchema.safeParse('a'.repeat(101));
    expect(tooLong.success).toBe(false);
  });
});

describe('createCategorySchema and updateCategorySchema', () => {
  it('both need a name and ignore anything else', () => {
    expect(createCategorySchema.parse({ name: ' Oils ', extra: 1 })).toEqual({ name: 'Oils' });
    expect(updateCategorySchema.parse({ name: ' Oils ' })).toEqual({ name: 'Oils' });
    expect(createCategorySchema.safeParse({}).success).toBe(false);
    expect(updateCategorySchema.safeParse({}).success).toBe(false);
  });
});

describe('listCategoriesQuerySchema', () => {
  it('is the standard paging query: 20 per page from the start', () => {
    expect(listCategoriesQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
    expect(listCategoriesQuerySchema.parse({ limit: '100', offset: '40' })).toEqual({
      limit: 100,
      offset: 40,
    });
    expect(listCategoriesQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});
