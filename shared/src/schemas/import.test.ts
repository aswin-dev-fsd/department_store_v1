import { describe, expect, it } from 'vitest';
import { IMPORT_COLUMNS, importRowSchema } from './import.js';

const cells = {
  code: 'RICE10',
  barcode: '8901234567890',
  name: 'Rice 10 kg',
  category: 'Grocery',
  mrp: '650.00',
  selling_price: '620',
  reorder_level: '5',
  opening_stock: '24',
};

/** The columns the schema complains about for these cells. */
function columnsWithProblems(overrides: Record<string, string>): string[] {
  const result = importRowSchema.safeParse({ ...cells, ...overrides });
  return result.success ? [] : [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
}

describe('IMPORT_COLUMNS', () => {
  it('lists the eight columns of the template, in order', () => {
    expect([...IMPORT_COLUMNS]).toEqual([
      'code',
      'barcode',
      'name',
      'category',
      'mrp',
      'selling_price',
      'reorder_level',
      'opening_stock',
    ]);
  });
});

describe('importRowSchema', () => {
  it('reads a complete row: text trimmed, prices in paise, numbers as numbers', () => {
    expect(
      importRowSchema.parse({ ...cells, code: ' RICE10 ', name: ' Rice 10 kg ', category: ' Grocery ' }),
    ).toEqual({
      code: 'RICE10',
      barcode: '8901234567890',
      name: 'Rice 10 kg',
      category: 'Grocery',
      mrp: 65000,
      selling_price: 62000,
      reorder_level: 5,
      opening_stock: 24,
    });
  });

  it('turns blank optional cells into null, and a blank opening stock into 0', () => {
    expect(
      importRowSchema.parse({
        ...cells,
        barcode: '',
        category: '   ',
        reorder_level: '',
        opening_stock: '  ',
      }),
    ).toMatchObject({ barcode: null, category: null, reorder_level: null, opening_stock: 0 });
  });

  it.each([
    ['145.50', 14550],
    ['145', 14500],
    ['145.5', 14550],
    ['0', 0],
    ['0.05', 5],
    [' 99.99 ', 9999],
    ['10000000.00', 1_000_000_000],
  ])('reads the price %j as %i paise', (text, paise) => {
    const row = importRowSchema.parse({ ...cells, mrp: text, selling_price: text });
    expect(row.mrp).toBe(paise);
    expect(row.selling_price).toBe(paise);
  });

  it.each(['abc', '1,200.00', '₹100', '-5', '12.345', '1e3', '', '   ', '10000000.01'])(
    'refuses the price %j, on the price column',
    (text) => {
      expect(columnsWithProblems({ mrp: text })).toEqual(['mrp']);
      expect(columnsWithProblems({ selling_price: text })).toEqual(['selling_price']);
    },
  );

  it('names the column at fault for blank and over-long cells', () => {
    expect(columnsWithProblems({ code: '  ' })).toEqual(['code']);
    expect(columnsWithProblems({ code: 'c'.repeat(41) })).toEqual(['code']);
    expect(columnsWithProblems({ name: '' })).toEqual(['name']);
    expect(columnsWithProblems({ name: 'n'.repeat(101) })).toEqual(['name']);
    expect(columnsWithProblems({ barcode: 'b'.repeat(51) })).toEqual(['barcode']);
    expect(columnsWithProblems({ category: 'c'.repeat(101) })).toEqual(['category']);
  });

  it.each(['0', '12', '1000000'])('accepts %j packs for the reorder level and the opening stock', (text) => {
    expect(columnsWithProblems({ reorder_level: text, opening_stock: text })).toEqual([]);
  });

  it.each(['-3', '1.5', 'abc', '1e3', '1000001', '12345678901'])(
    'refuses %j packs, on each of the two columns',
    (text) => {
      expect(columnsWithProblems({ reorder_level: text })).toEqual(['reorder_level']);
      expect(columnsWithProblems({ opening_stock: text })).toEqual(['opening_stock']);
    },
  );

  it('reports every cell at fault, in one pass', () => {
    expect(columnsWithProblems({ code: '', mrp: 'x', opening_stock: '-1' })).toEqual([
      'code',
      'mrp',
      'opening_stock',
    ]);
  });
});
