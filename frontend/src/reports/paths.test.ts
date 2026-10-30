import { describe, expect, it } from 'vitest';
import {
  adminReportPath,
  isPaged,
  monthStart,
  ownDaySummaryPath,
  ownStockPath,
  reportDates,
  today,
  type AdminReportChoice,
} from './paths';

const choice: AdminReportChoice = {
  report: 'day-summary',
  branchId: null,
  date: '2026-10-30',
  from: '2026-10-01',
  to: '2026-10-30',
};

describe('report dates', () => {
  it('uses the IST business date for today: 23:30 IST is still that day, 00:10 IST the next', () => {
    expect(today(new Date('2026-10-30T18:00:00Z'))).toBe('2026-10-30');
    expect(today(new Date('2026-10-30T18:40:00Z'))).toBe('2026-10-31');
  });

  it('starts a month on its 1st', () => {
    expect(monthStart('2026-10-30')).toBe('2026-10-01');
  });

  it('knows which reports take a day, a range or neither, and which are paged', () => {
    expect(
      (['day-summary', 'item-sales', 'stock', 'low-stock', 'purchase-register'] as const).map(
        (report) => [reportDates(report), isPaged(report)],
      ),
    ).toEqual([
      ['day', false],
      ['range', true],
      ['none', true],
      ['none', true],
      ['range', false],
    ]);
  });
});

describe('cashier report addresses', () => {
  it('asks for their own day and their branch stock', () => {
    expect(ownDaySummaryPath('2026-10-30')).toBe('/reports/day-summary?date=2026-10-30');
    expect(ownStockPath(false, 0)).toBe('/reports/stock?limit=20&offset=0');
    expect(ownStockPath(true, 20)).toBe('/reports/low-stock?limit=20&offset=20');
  });
});

describe('adminReportPath', () => {
  it('sends only what each report takes', () => {
    expect(adminReportPath(choice, 0)).toBe('/admin/reports/day-summary?date=2026-10-30');
    expect(adminReportPath({ ...choice, report: 'item-sales' }, 40)).toBe(
      '/admin/reports/item-sales?from=2026-10-01&to=2026-10-30&limit=20&offset=40',
    );
    expect(adminReportPath({ ...choice, report: 'purchase-register' }, 0)).toBe(
      '/admin/reports/purchase-register?from=2026-10-01&to=2026-10-30',
    );
    expect(adminReportPath({ ...choice, report: 'low-stock' }, 0)).toBe(
      '/admin/reports/low-stock?limit=20&offset=0',
    );
  });

  it('names the branch only when one is chosen', () => {
    expect(adminReportPath({ ...choice, branchId: 3 }, 0)).toBe(
      '/admin/reports/day-summary?date=2026-10-30&branchId=3',
    );
  });
});
