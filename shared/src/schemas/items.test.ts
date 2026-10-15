import { describe, expect, it } from 'vitest';
import {
  createItemSchema,
  itemCodeSchema,
  itemNameSchema,
  listItemsQuerySchema,
  lookupItemQuerySchema,
  MAX_PRICE_PAISE,
  updateItemSchema,
} from './items.js';

const valid = { code: 'RICE10', name: 'Rice 10 kg', mrpPaise: 65000, sellingPricePaise: 62000 };

function firstIssuePath(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}) {
  return result.error?.issues[0]?.path.join('.');
}

describe('itemCodeSchema and itemNameSchema', () => {
  it('trim the text and keep its case and any script', () => {
    expect(itemCodeSchema.parse('  rice-10 ')).toBe('rice-10');
    expect(itemNameSchema.parse('  அரிசி 10 kg ')).toBe('அரிசி 10 kg');
  });

  it('refuse blank text', () => {
    expect(itemCodeSchema.safeParse('  ').success).toBe(false);
    expect(itemNameSchema.safeParse('').success).toBe(false);
  });

  it('allow up to 40 characters for a code and 100 for a name, and refuse more', () => {
    expect(itemCodeSchema.safeParse('c'.repeat(40)).success).toBe(true);
    expect(itemCodeSchema.safeParse('c'.repeat(41)).success).toBe(false);
    expect(itemNameSchema.safeParse('n'.repeat(100)).success).toBe(true);
    expect(itemNameSchema.safeParse('n'.repeat(101)).success).toBe(false);
  });
});

describe('createItemSchema', () => {
  it('takes the required fields, trims the text, and ignores anything else (isActive included)', () => {
    expect(
      createItemSchema.parse({ ...valid, code: ' RICE10 ', name: ' Rice 10 kg ', isActive: false }),
    ).toEqual(valid);
  });

  it('takes the optional fields: barcode, category and reorder level', () => {
    expect(
      createItemSchema.parse({
        ...valid,
        barcode: ' 8901234567890 ',
        categoryId: 3,
        reorderLevel: 5,
      }),
    ).toEqual({ ...valid, barcode: '8901234567890', categoryId: 3, reorderLevel: 5 });
  });

  it('turns a blank barcode into null, so it is "no barcode"', () => {
    expect(createItemSchema.parse({ ...valid, barcode: '   ' }).barcode).toBeNull();
  });

  it('allows no category and no reorder level (null)', () => {
    const parsed = createItemSchema.parse({ ...valid, categoryId: null, reorderLevel: null });
    expect(parsed.categoryId).toBeNull();
    expect(parsed.reorderLevel).toBeNull();
  });

  it.each(['code', 'name', 'mrpPaise', 'sellingPricePaise'])('needs %s', (field) => {
    const { [field]: _left, ...rest } = valid as Record<string, unknown>;
    expect(createItemSchema.safeParse(rest).success).toBe(false);
  });

  it.each([
    ['a fraction of a paisa', 99.5],
    ['text', '100'],
    ['a negative amount', -1],
    ['more than the limit', MAX_PRICE_PAISE + 1],
    ['not a number', Number.NaN],
  ])('refuses a price that is %s', (_label, price) => {
    expect(createItemSchema.safeParse({ ...valid, mrpPaise: price }).success).toBe(false);
    expect(createItemSchema.safeParse({ ...valid, sellingPricePaise: price }).success).toBe(false);
  });

  it('allows a price of 0 and the limit itself', () => {
    expect(
      createItemSchema.safeParse({ ...valid, mrpPaise: MAX_PRICE_PAISE, sellingPricePaise: 0 })
        .success,
    ).toBe(true);
  });

  it('refuses a selling price above the MRP, on the selling price', () => {
    const result = createItemSchema.safeParse({ ...valid, mrpPaise: 100, sellingPricePaise: 101 });
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe('sellingPricePaise');
  });

  it('allows a selling price equal to the MRP', () => {
    expect(
      createItemSchema.safeParse({ ...valid, mrpPaise: 100, sellingPricePaise: 100 }).success,
    ).toBe(true);
  });

  it.each([0, -1, 1.5])('refuses the category id %j', (categoryId) => {
    expect(createItemSchema.safeParse({ ...valid, categoryId }).success).toBe(false);
  });

  it.each([-1, 1.5, 1_000_001])('refuses the reorder level %j', (reorderLevel) => {
    expect(createItemSchema.safeParse({ ...valid, reorderLevel }).success).toBe(false);
  });
});

describe('updateItemSchema', () => {
  it('takes any subset of the fields, including isActive', () => {
    expect(updateItemSchema.parse({ name: ' New name ' })).toEqual({ name: 'New name' });
    expect(updateItemSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(updateItemSchema.parse({ sellingPricePaise: 100 })).toEqual({ sellingPricePaise: 100 });
  });

  it('lets the barcode, category and reorder level be cleared with null', () => {
    expect(updateItemSchema.parse({ barcode: null, categoryId: null, reorderLevel: null })).toEqual(
      {
        barcode: null,
        categoryId: null,
        reorderLevel: null,
      },
    );
    expect(updateItemSchema.parse({ barcode: ' ' })).toEqual({ barcode: null });
  });

  it('needs at least one field', () => {
    expect(updateItemSchema.safeParse({}).success).toBe(false);
    expect(updateItemSchema.safeParse({ unknown: 1 }).success).toBe(false);
  });

  it('refuses a selling price above the MRP when both are sent, but leaves a single price to the server', () => {
    const both = updateItemSchema.safeParse({ mrpPaise: 100, sellingPricePaise: 101 });
    expect(both.success).toBe(false);
    expect(firstIssuePath(both)).toBe('sellingPricePaise');
    expect(updateItemSchema.safeParse({ sellingPricePaise: 10_000_000 }).success).toBe(true);
  });

  it('applies the same rules as create to each field', () => {
    expect(updateItemSchema.safeParse({ code: ' ' }).success).toBe(false);
    expect(updateItemSchema.safeParse({ mrpPaise: 1.5 }).success).toBe(false);
    expect(updateItemSchema.safeParse({ categoryId: 0 }).success).toBe(false);
  });
});

describe('listItemsQuerySchema', () => {
  it('is the standard paging query with no filters by default', () => {
    expect(listItemsQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
  });

  it('takes search (trimmed; blank means none), categoryId and active', () => {
    expect(
      listItemsQuerySchema.parse({ search: '  rice ', categoryId: '7', active: 'false' }),
    ).toEqual({ limit: 20, offset: 0, search: 'rice', categoryId: 7, active: false });
    expect(listItemsQuerySchema.parse({ search: '   ' }).search).toBeUndefined();
    expect(listItemsQuerySchema.parse({ active: 'true' }).active).toBe(true);
  });

  it.each([{ categoryId: 'abc' }, { categoryId: '0' }, { active: 'maybe' }, { limit: '101' }])(
    'refuses %j',
    (query) => {
      expect(listItemsQuerySchema.safeParse(query).success).toBe(false);
    },
  );

  it('refuses a search longer than 100 characters', () => {
    expect(listItemsQuerySchema.safeParse({ search: 's'.repeat(101) }).success).toBe(false);
  });
});

describe('lookupItemQuerySchema', () => {
  it('takes a barcode or a code, trimmed', () => {
    expect(lookupItemQuerySchema.parse({ barcode: ' 8901 ' })).toEqual({ barcode: '8901' });
    expect(lookupItemQuerySchema.parse({ code: ' RICE10 ' })).toEqual({ code: 'RICE10' });
  });

  it('needs exactly one of them', () => {
    expect(lookupItemQuerySchema.safeParse({}).success).toBe(false);
    expect(lookupItemQuerySchema.safeParse({ barcode: '1', code: 'A' }).success).toBe(false);
    expect(lookupItemQuerySchema.safeParse({ barcode: '   ' }).success).toBe(false);
  });
});
