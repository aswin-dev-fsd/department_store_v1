import { businessDate, type ReportName } from '@ds/shared';

// What the report screens ask the API for. Kept apart from the screens so the addresses can be
// tested without React.

/** Rows per screen in the paged reports (item-wise sales, stock): the API's default. */
export const REPORT_PAGE_SIZE = 20;

/** Today's IST business date, YYYY-MM-DD: the default report day. */
export function today(at: Date = new Date()): string {
  return businessDate(at);
}

/** The first day of the month `date` is in. */
export function monthStart(date: string): string {
  return `${date.slice(0, 8)}01`;
}

/** The cashier's own day summary. */
export function ownDaySummaryPath(date: string): string {
  return `/reports/day-summary?${new URLSearchParams({ date }).toString()}`;
}

/** A page of the cashier's branch stock, or its low stock. */
export function ownStockPath(low: boolean, offset: number): string {
  const params = new URLSearchParams({ limit: String(REPORT_PAGE_SIZE), offset: String(offset) });
  return `/reports/${low ? 'low-stock' : 'stock'}?${params.toString()}`;
}

/** What the Admin has chosen on the reports screen. */
export interface AdminReportChoice {
  report: ReportName;
  /** null means every branch. */
  branchId: number | null;
  /** The day summary's day. */
  date: string;
  /** Item-wise sales' and the purchase register's range, both ends included. */
  from: string;
  to: string;
}

/** Which inputs a report takes: one day, a range, or neither. */
export function reportDates(report: ReportName): 'day' | 'range' | 'none' {
  if (report === 'day-summary') return 'day';
  if (report === 'item-sales' || report === 'purchase-register') return 'range';
  return 'none';
}

/** Whether a report comes in pages. */
export function isPaged(report: ReportName): boolean {
  return report === 'item-sales' || report === 'stock' || report === 'low-stock';
}

/** The API address of the Admin's chosen report; only the fields that report takes are sent. */
export function adminReportPath(choice: AdminReportChoice, offset: number): string {
  const params = new URLSearchParams();
  const dates = reportDates(choice.report);
  if (dates === 'day') params.set('date', choice.date);
  if (dates === 'range') {
    params.set('from', choice.from);
    params.set('to', choice.to);
  }
  if (choice.branchId !== null) params.set('branchId', String(choice.branchId));
  if (isPaged(choice.report)) {
    params.set('limit', String(REPORT_PAGE_SIZE));
    params.set('offset', String(offset));
  }
  const query = params.toString();
  return `/admin/reports/${choice.report}${query ? `?${query}` : ''}`;
}
