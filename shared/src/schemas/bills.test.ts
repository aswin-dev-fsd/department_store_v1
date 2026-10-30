import { describe, expect, it } from 'vitest';
import {
  cancelBillSchema,
  createBillSchema,
  listBillsQuerySchema,
  MAX_BILL_LINE_QUANTITY,
  MAX_BILL_LINES,
} from './bills.js';

function firstIssuePath(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}) {
  return result.error?.issues[0]?.path.join('.');
}

const valid = () => ({
  lines: [{ itemId: 7, quantity: 2, discountPaise: 500 }],
  payments: [{ mode: 'cash', amountPaise: 12900 }],
});

describe('createBillSchema', () => {
  it('accepts a bill of ids, quantities, discounts and payments', () => {
    expect(createBillSchema.parse(valid())).toEqual(valid());
  });

  it('treats a left-out discount as none', () => {
    const parsed = createBillSchema.parse({ ...valid(), lines: [{ itemId: 7, quantity: 1 }] });
    expect(parsed.lines[0]).toEqual({ itemId: 7, quantity: 1, discountPaise: 0 });
  });

  it('takes an optional customer and normalises the phone', () => {
    const parsed = createBillSchema.parse({
      ...valid(),
      customer: { phone: '+91 98765 43210', name: ' Kumar ' },
    });
    expect(parsed.customer).toEqual({ phone: '9876543210', name: 'Kumar' });
  });

  it.each([
    ['a unit price on a line', { lines: [{ itemId: 7, quantity: 1, unitPricePaise: 1 }] }, 'lines.0'],
    ['a line total', { lines: [{ itemId: 7, quantity: 1, lineTotalPaise: 1 }] }, 'lines.0'],
    ['a bill total', { totalPaise: 1 }, ''],
    ['a field on a payment', { payments: [{ mode: 'cash', amountPaise: 1, change: 5 }] }, 'payments.0'],
    ['a field on the customer', { customer: { phone: '9876543210', id: 3 } }, 'customer'],
  ])('refuses %s: prices and totals are the server’s', (_label, overrides, path) => {
    expect(firstIssuePath(createBillSchema.safeParse({ ...valid(), ...overrides }))).toBe(path);
  });

  it.each([
    ['no lines', { lines: [] }, 'lines'],
    ['too many lines', { lines: Array(MAX_BILL_LINES + 1).fill({ itemId: 7, quantity: 1 }) }, 'lines'],
    ['a quantity of 0', { lines: [{ itemId: 7, quantity: 0 }] }, 'lines.0.quantity'],
    ['a part pack', { lines: [{ itemId: 7, quantity: 1.5 }] }, 'lines.0.quantity'],
    [
      'a quantity above the cap',
      { lines: [{ itemId: 7, quantity: MAX_BILL_LINE_QUANTITY + 1 }] },
      'lines.0.quantity',
    ],
    ['a negative discount', { lines: [{ itemId: 7, quantity: 1, discountPaise: -1 }] }, 'lines.0.discountPaise'],
    ['a missing item', { lines: [{ quantity: 1 }] }, 'lines.0.itemId'],
    ['no payments', { payments: [] }, 'payments'],
    ['a payment of 0', { payments: [{ mode: 'cash', amountPaise: 0 }] }, 'payments.0.amountPaise'],
    ['an unknown mode', { payments: [{ mode: 'cheque', amountPaise: 1 }] }, 'payments.0.mode'],
    [
      'the same mode twice',
      {
        payments: [
          { mode: 'cash', amountPaise: 1 },
          { mode: 'cash', amountPaise: 2 },
        ],
      },
      'payments',
    ],
    ['a bad phone', { customer: { phone: '12345' } }, 'customer.phone'],
  ])('refuses %s', (_label, overrides, path) => {
    expect(firstIssuePath(createBillSchema.safeParse({ ...valid(), ...overrides }))).toBe(path);
  });
});

describe('cancelBillSchema', () => {
  it('trims the reason and allows 3 to 200 characters', () => {
    expect(cancelBillSchema.parse({ reason: '  Wrong item ' })).toEqual({ reason: 'Wrong item' });
    expect(cancelBillSchema.safeParse({ reason: 'Dup' }).success).toBe(true);
    expect(cancelBillSchema.safeParse({ reason: 'x'.repeat(200) }).success).toBe(true);
  });

  it.each([
    ['missing', {}],
    ['2 characters after trimming', { reason: ' ab ' }],
    ['201 characters', { reason: 'x'.repeat(201) }],
  ])('refuses a reason that is %s', (_label, input) => {
    expect(firstIssuePath(cancelBillSchema.safeParse(input))).toBe('reason');
  });
});

describe('listBillsQuerySchema', () => {
  it('defaults the page and leaves every filter out', () => {
    expect(listBillsQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
  });

  it('reads every filter, normalising the phone and dropping a blank bill number', () => {
    expect(
      listBillsQuerySchema.parse({
        from: '2026-10-01',
        to: '2026-10-31',
        billNo: '  ',
        phone: '+91 98765 43210',
        cashierId: '4',
        status: 'cancelled',
      }),
    ).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      phone: '9876543210',
      cashierId: 4,
      status: 'cancelled',
      limit: 20,
      offset: 0,
    });
  });

  it.each([
    ['a day that does not exist', { from: '2026-02-30' }, 'from'],
    ['an end date before the start', { from: '2026-10-31', to: '2026-10-01' }, 'to'],
    ['a bad phone', { phone: '12345' }, 'phone'],
    ['a cashier id of 0', { cashierId: '0' }, 'cashierId'],
    ['an unknown status', { status: 'void' }, 'status'],
  ])('refuses %s', (_label, query, path) => {
    expect(firstIssuePath(listBillsQuerySchema.safeParse(query))).toBe(path);
  });
});
