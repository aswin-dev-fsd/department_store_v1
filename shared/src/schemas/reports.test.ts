import { describe, expect, it } from 'vitest';
import {
  adminReportQuerySchemas,
  daysInRange,
  MAX_REPORT_DAYS,
  ownDaySummaryQuerySchema,
  ownStockReportQuerySchema,
  reportParamsSchema,
} from './reports.js';

describe('daysInRange', () => {
  it.each([
    ['2026-10-30', '2026-10-30', 1],
    ['2026-10-01', '2026-10-31', 31],
    ['2026-01-01', '2027-01-01', 366],
    ['2028-01-01', '2028-12-31', 366], // a leap year
  ])('%s to %s is %i days, both ends counted', (from, to, days) => {
    expect(daysInRange(from, to)).toBe(days);
  });
});

describe('cashier report queries', () => {
  it('take a date for the day summary and nothing else', () => {
    expect(ownDaySummaryQuerySchema.parse({ date: '2026-10-30' })).toEqual({ date: '2026-10-30' });
    expect(ownDaySummaryQuerySchema.safeParse({ date: '2026-10-30', cashierId: '2' }).success).toBe(
      false,
    );
    expect(ownDaySummaryQuerySchema.safeParse({ date: '2026-10-30', branchId: '2' }).success).toBe(
      false,
    );
    expect(ownDaySummaryQuerySchema.safeParse({ date: '2026-02-30' }).success).toBe(false);
  });

  it('take a category and paging for stock, but no branch', () => {
    expect(ownStockReportQuerySchema.parse({ categoryId: '3' })).toEqual({
      categoryId: 3,
      limit: 20,
      offset: 0,
    });
    expect(ownStockReportQuerySchema.safeParse({ branchId: '2' }).success).toBe(false);
  });
});

describe('Admin report queries', () => {
  const sales = adminReportQuerySchemas['item-sales'];

  it('name one of the five reports', () => {
    expect(reportParamsSchema.parse({ report: 'low-stock' })).toEqual({ report: 'low-stock' });
    expect(reportParamsSchema.safeParse({ report: 'profit' }).success).toBe(false);
  });

  it(`allow a range of up to ${MAX_REPORT_DAYS} days, never ending before it starts`, () => {
    expect(sales.safeParse({ from: '2026-01-01', to: '2027-01-01' }).success).toBe(true);
    const tooLong = sales.safeParse({ from: '2026-01-01', to: '2027-01-02' });
    expect(tooLong.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['to', 'Choose a range of at most 366 days'],
    ]);
    const backwards = sales.safeParse({ from: '2026-10-31', to: '2026-10-01' });
    expect(backwards.error?.issues.map((issue) => issue.message)).toEqual([
      'The end date cannot be before the start date',
    ]);
  });

  it('take an optional branch on every report, and only the fields each report uses', () => {
    expect(adminReportQuerySchemas['day-summary'].parse({ date: '2026-10-30' })).toEqual({
      date: '2026-10-30',
    });
    expect(
      adminReportQuerySchemas['purchase-register'].parse({
        from: '2026-10-01',
        to: '2026-10-31',
        branchId: '4',
      }),
    ).toEqual({ from: '2026-10-01', to: '2026-10-31', branchId: 4 });
    expect(adminReportQuerySchemas.stock.safeParse({ date: '2026-10-30' }).success).toBe(false);
    expect(
      adminReportQuerySchemas['purchase-register'].safeParse({
        from: '2026-10-01',
        to: '2026-10-31',
        limit: '5',
      }).success,
    ).toBe(false);
  });
});
