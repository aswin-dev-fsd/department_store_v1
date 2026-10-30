import { describe, expect, it } from 'vitest';
import {
  computeBill,
  computeLine,
  formatBillNo,
  MAX_BILL_NO_LENGTH,
  MAX_BILL_SEQ,
  roundToRupee,
} from './billing.js';

describe('computeBill', () => {
  it('reproduces the overview §6.4 worked example exactly', () => {
    const bill = computeBill([
      { unitPricePaise: 65000, quantity: 1, discountPaise: 2000 }, // Rice 10 kg
      { unitPricePaise: 14550, quantity: 2, discountPaise: 0 }, // Sunflower Oil 1 L
      { unitPricePaise: 3825, quantity: 3, discountPaise: 0 }, // Bath Soap 100 g
    ]);
    expect(bill).toMatchObject({
      subtotalPaise: 105575,
      discountPaise: 2000,
      roundOffPaise: 25,
      totalPaise: 103600,
    });
    expect(bill.lines.map((line) => [line.amountPaise, line.lineTotalPaise])).toEqual([
      [65000, 63000],
      [29100, 29100],
      [11475, 11475],
    ]);
  });

  it('keeps each line in order with what it was given', () => {
    const bill = computeBill([
      { unitPricePaise: 100, quantity: 2, discountPaise: 50 },
      { unitPricePaise: 300, quantity: 1, discountPaise: 0 },
    ]);
    expect(bill.lines).toEqual([
      { unitPricePaise: 100, quantity: 2, discountPaise: 50, amountPaise: 200, lineTotalPaise: 150 },
      { unitPricePaise: 300, quantity: 1, discountPaise: 0, amountPaise: 300, lineTotalPaise: 300 },
    ]);
  });

  it.each([
    [10050, 10100, 50],
    [10049, 10000, -49],
    [10000, 10000, 0],
    [10001, 10000, -1],
    [10099, 10100, 1],
  ])('rounds a net of %i paise to %i (round-off %i)', (net, total, roundOff) => {
    const bill = computeBill([{ unitPricePaise: net, quantity: 1, discountPaise: 0 }]);
    expect(bill).toMatchObject({ totalPaise: total, roundOffPaise: roundOff });
  });

  it('rounds after the discount: subtotal − discount is what is rounded', () => {
    // 2 × 50.25 = 100.50, minus 0.01 = 100.49 → 100.00
    const bill = computeBill([{ unitPricePaise: 5025, quantity: 2, discountPaise: 1 }]);
    expect(bill).toMatchObject({
      subtotalPaise: 10050,
      discountPaise: 1,
      roundOffPaise: -49,
      totalPaise: 10000,
    });
  });

  it('allows a free line and a fully discounted line, totalling 0', () => {
    const bill = computeBill([
      { unitPricePaise: 0, quantity: 3, discountPaise: 0 },
      { unitPricePaise: 4000, quantity: 1, discountPaise: 4000 },
    ]);
    expect(bill).toMatchObject({ subtotalPaise: 4000, discountPaise: 4000, totalPaise: 0 });
  });

  it('gives zeros for no lines (the bill service refuses an empty bill)', () => {
    expect(computeBill([])).toEqual({
      lines: [],
      subtotalPaise: 0,
      discountPaise: 0,
      roundOffPaise: 0,
      totalPaise: 0,
    });
  });

  it('refuses a bill whose subtotal could not be added up exactly', () => {
    const huge = { unitPricePaise: Number.MAX_SAFE_INTEGER, quantity: 1, discountPaise: 0 };
    expect(() => computeBill([huge, huge])).toThrow(RangeError);
  });
});

describe('computeLine: limits', () => {
  it('refuses a discount larger than the line amount', () => {
    expect(() => computeLine({ unitPricePaise: 1000, quantity: 2, discountPaise: 2001 })).toThrow(
      RangeError,
    );
  });

  it('allows a discount equal to the line amount', () => {
    expect(computeLine({ unitPricePaise: 1000, quantity: 2, discountPaise: 2000 })).toMatchObject({
      lineTotalPaise: 0,
    });
  });

  it.each([
    ['a negative discount', { discountPaise: -1 }],
    ['a discount in part paise', { discountPaise: 0.5 }],
    ['a quantity of 0', { quantity: 0 }],
    ['a negative quantity', { quantity: -1 }],
    ['a part pack', { quantity: 1.5 }],
    ['a negative price', { unitPricePaise: -1 }],
    ['a price in part paise', { unitPricePaise: 10.5 }],
    ['a price that is not a number', { unitPricePaise: Number.NaN }],
  ])('refuses %s', (_label, overrides) => {
    expect(() =>
      computeLine({ unitPricePaise: 1000, quantity: 1, discountPaise: 0, ...overrides }),
    ).toThrow(RangeError);
  });

  it('refuses a line amount that could not be multiplied exactly', () => {
    expect(() =>
      computeLine({ unitPricePaise: Number.MAX_SAFE_INTEGER, quantity: 2, discountPaise: 0 }),
    ).toThrow(RangeError);
  });
});

describe('roundToRupee', () => {
  it('rounds exactly 50 paise up, and less down', () => {
    expect(roundToRupee(50)).toBe(100);
    expect(roundToRupee(49)).toBe(0);
    expect(roundToRupee(0)).toBe(0);
  });

  it('refuses a negative amount', () => {
    expect(() => roundToRupee(-1)).toThrow(RangeError);
  });
});

describe('formatBillNo', () => {
  it('formats the branch code, financial year and a 6-digit number', () => {
    expect(formatBillNo('TPR', '26-27', 123)).toBe('TPR/26-27/000123');
    expect(formatBillNo('TPR', '26-27', 1)).toBe('TPR/26-27/000001');
  });

  it(`is never longer than ${MAX_BILL_NO_LENGTH} characters`, () => {
    const longest = formatBillNo('ABC', '99-00', MAX_BILL_SEQ);
    expect(longest).toBe('ABC/99-00/999999');
    expect(longest.length).toBe(MAX_BILL_NO_LENGTH);
    expect(() => formatBillNo('ABCD', '26-27', 1)).toThrow(RangeError);
  });

  it('refuses a sequence above 999999', () => {
    expect(() => formatBillNo('TPR', '26-27', MAX_BILL_SEQ + 1)).toThrow(RangeError);
  });

  it.each([0, -1, 1.5])('refuses a sequence of %d', (seq) => {
    expect(() => formatBillNo('TPR', '26-27', seq)).toThrow(RangeError);
  });
});
