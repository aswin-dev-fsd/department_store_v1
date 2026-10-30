import { normalisePhone, type BillStatus } from '@ds/shared';

// What the bills list asks the API for. Kept apart from the screens so the addresses can be
// tested without React.

/** Rows per screen in the bills list: the API's default. */
export const BILL_PAGE_SIZE = 20;

export interface BillFilters {
  /** Any part of the bill number; empty means any. */
  billNo: string;
  /** The customer's mobile as typed; empty means any customer or none. */
  phone: string;
  /** Business dates from and to (YYYY-MM-DD, both included); empty means no limit. */
  from: string;
  to: string;
  status: BillStatus | 'all';
}

/** What the list shows first: every bill, newest first. */
export const DEFAULT_BILL_FILTERS: BillFilters = {
  billNo: '',
  phone: '',
  from: '',
  to: '',
  status: 'all',
};

/**
 * The API address of one page of bills under these filters. A phone is sent as its 10 digits;
 * one that is not a mobile number is left out (the screen says so).
 */
export function billsPath(filters: BillFilters, offset: number): string {
  const params = new URLSearchParams({ limit: String(BILL_PAGE_SIZE), offset: String(offset) });
  if (filters.billNo !== '') params.set('billNo', filters.billNo);
  const phone = normalisePhone(filters.phone);
  if (phone !== null) params.set('phone', phone);
  if (filters.from !== '') params.set('from', filters.from);
  if (filters.to !== '') params.set('to', filters.to);
  if (filters.status !== 'all') params.set('status', filters.status);
  return `/bills?${params.toString()}`;
}
