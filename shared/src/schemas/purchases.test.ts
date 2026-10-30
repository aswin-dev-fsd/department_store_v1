import { describe, expect, it } from 'vitest';
import { MAX_PRICE_PAISE } from './items.js';
import {
  listPurchasesQuerySchema,
  MAX_LINE_QUANTITY,
  MAX_PURCHASE_LINES,
  PURCHASE_TOTAL_TOO_LARGE_MESSAGE,
  purchaseDraftSchema,
  purchaseTotalPaise,
  vendorInvoiceNoSchema,
} from './purchases.js';

function firstIssuePath(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}) {
  return result.error?.issues[0]?.path.join('.');
}

const line = (overrides: Record<string, unknown> = {}) => ({
  itemId: 1,
  quantity: 10,
  costPricePaise: 4500,
  ...overrides,
});

const draft = (overrides: Record<string, unknown> = {}) => ({
  vendorId: 1,
  vendorInvoiceNo: 'INV-1',
  invoiceDate: '2026-10-30',
  lines: [line()],
  ...overrides,
});

describe('vendorInvoiceNoSchema', () => {
  it('trims the number and keeps its case', () => {
    expect(vendorInvoiceNoSchema.parse('  inv/2231 ')).toBe('inv/2231');
  });

  it('refuses a blank number', () => {
    expect(vendorInvoiceNoSchema.safeParse('').success).toBe(false);
    expect(vendorInvoiceNoSchema.safeParse('   ').success).toBe(false);
  });

  it('allows up to 50 characters and refuses more', () => {
    expect(vendorInvoiceNoSchema.safeParse('n'.repeat(50)).success).toBe(true);
    expect(vendorInvoiceNoSchema.safeParse('n'.repeat(51)).success).toBe(false);
  });
});

describe('purchaseDraftSchema', () => {
  it('accepts a draft with lines, and one with none (lines left out means none)', () => {
    expect(purchaseDraftSchema.safeParse(draft()).success).toBe(true);
    expect(purchaseDraftSchema.parse(draft({ lines: [] })).lines).toEqual([]);
    const { lines: _lines, ...withoutLines } = draft();
    expect(purchaseDraftSchema.parse(withoutLines).lines).toEqual([]);
  });

  it('drops what the server decides: totals, status, and batch and expiry (PD-02)', () => {
    const parsed = purchaseDraftSchema.parse(
      draft({
        totalPaise: 1,
        status: 'posted',
        lines: [line({ lineTotalPaise: 1, batchNo: 'B-1', expiryDate: '2027-01-01' })],
      }),
    );
    expect(parsed).not.toHaveProperty('totalPaise');
    expect(parsed).not.toHaveProperty('status');
    expect(parsed.lines[0]).toEqual({ itemId: 1, quantity: 10, costPricePaise: 4500 });
  });

  it('keeps optional new prices, and null for none', () => {
    const parsed = purchaseDraftSchema.parse(
      draft({ lines: [line({ newMrpPaise: 5000, newSellingPricePaise: null })] }),
    );
    expect(parsed.lines[0]).toMatchObject({ newMrpPaise: 5000, newSellingPricePaise: null });
  });

  it('treats blank notes as none', () => {
    expect(purchaseDraftSchema.parse(draft({ notes: '  ' })).notes).toBeNull();
  });

  it.each([
    ['a missing vendor', { vendorId: undefined }, 'vendorId'],
    ['a vendor id of 0', { vendorId: 0 }, 'vendorId'],
    ['a blank invoice number', { vendorInvoiceNo: ' ' }, 'vendorInvoiceNo'],
    ['a date in another format', { invoiceDate: '30/10/2026' }, 'invoiceDate'],
    ['a day that does not exist', { invoiceDate: '2026-02-30' }, 'invoiceDate'],
    ['month 13', { invoiceDate: '2026-13-01' }, 'invoiceDate'],
    ['a date with a time', { invoiceDate: '2026-10-30T10:00' }, 'invoiceDate'],
  ])('refuses %s', (_label, overrides, path) => {
    expect(firstIssuePath(purchaseDraftSchema.safeParse(draft(overrides)))).toBe(path);
  });

  it('accepts 29 February in a leap year only', () => {
    expect(purchaseDraftSchema.safeParse(draft({ invoiceDate: '2028-02-29' })).success).toBe(true);
    expect(purchaseDraftSchema.safeParse(draft({ invoiceDate: '2026-02-29' })).success).toBe(false);
  });

  it.each([
    ['a quantity of 0', { quantity: 0 }, 'lines.0.quantity'],
    ['a negative quantity', { quantity: -1 }, 'lines.0.quantity'],
    ['a part pack', { quantity: 1.5 }, 'lines.0.quantity'],
    ['a quantity above the cap', { quantity: MAX_LINE_QUANTITY + 1 }, 'lines.0.quantity'],
    ['a negative cost price', { costPricePaise: -1 }, 'lines.0.costPricePaise'],
    ['a cost price in part paise', { costPricePaise: 10.5 }, 'lines.0.costPricePaise'],
    [
      'a cost price above the cap',
      { costPricePaise: MAX_PRICE_PAISE + 1 },
      'lines.0.costPricePaise',
    ],
    ['a negative new MRP', { newMrpPaise: -1 }, 'lines.0.newMrpPaise'],
    ['a negative new selling price', { newSellingPricePaise: -1 }, 'lines.0.newSellingPricePaise'],
    ['a missing item', { itemId: undefined }, 'lines.0.itemId'],
  ])('refuses a line with %s', (_label, overrides, path) => {
    expect(firstIssuePath(purchaseDraftSchema.safeParse(draft({ lines: [line(overrides)] })))).toBe(
      path,
    );
  });

  it('accepts a cost price of zero (a free item)', () => {
    expect(
      purchaseDraftSchema.safeParse(draft({ lines: [line({ costPricePaise: 0 })] })).success,
    ).toBe(true);
  });

  it(`allows ${MAX_PURCHASE_LINES} lines and refuses more`, () => {
    const lines = (n: number) => Array.from({ length: n }, () => line());
    expect(purchaseDraftSchema.safeParse(draft({ lines: lines(MAX_PURCHASE_LINES) })).success).toBe(
      true,
    );
    const tooMany = purchaseDraftSchema.safeParse(draft({ lines: lines(MAX_PURCHASE_LINES + 1) }));
    expect(firstIssuePath(tooMany)).toBe('lines');
  });

  it('refuses lines whose total the server could not add up exactly', () => {
    const big = line({ quantity: MAX_LINE_QUANTITY, costPricePaise: MAX_PRICE_PAISE });
    const result = purchaseDraftSchema.safeParse(draft({ lines: Array(10).fill(big) }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(PURCHASE_TOTAL_TOO_LARGE_MESSAGE);
  });
});

describe('purchaseTotalPaise', () => {
  it('adds quantity × cost price over the lines; no lines total 0', () => {
    expect(
      purchaseTotalPaise([
        { quantity: 12, costPricePaise: 4500 },
        { quantity: 3, costPricePaise: 199 },
      ]),
    ).toBe(54597);
    expect(purchaseTotalPaise([])).toBe(0);
  });
});

describe('listPurchasesQuerySchema', () => {
  it('defaults the page and leaves every filter out', () => {
    expect(listPurchasesQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
  });

  it('reads the status, vendor and dates from the query string', () => {
    expect(
      listPurchasesQuerySchema.parse({
        status: 'draft',
        vendorId: '7',
        from: '2026-10-01',
        to: '2026-10-31',
      }),
    ).toEqual({
      status: 'draft',
      vendorId: 7,
      from: '2026-10-01',
      to: '2026-10-31',
      limit: 20,
      offset: 0,
    });
  });

  it('allows a range of one day', () => {
    expect(
      listPurchasesQuerySchema.safeParse({ from: '2026-10-30', to: '2026-10-30' }).success,
    ).toBe(true);
  });

  it.each([
    ['an unknown status', { status: 'deleted' }, 'status'],
    ['a vendor id that is not a number', { vendorId: 'abc' }, 'vendorId'],
    ['a vendor id of 0', { vendorId: '0' }, 'vendorId'],
    ['a start date that does not exist', { from: '2026-02-30' }, 'from'],
    ['an end date before the start', { from: '2026-10-31', to: '2026-10-01' }, 'to'],
  ])('refuses %s', (_label, query, path) => {
    expect(firstIssuePath(listPurchasesQuerySchema.safeParse(query))).toBe(path);
  });
});
