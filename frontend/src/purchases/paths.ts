import type { PurchaseStatus } from '@ds/shared';

// What the purchase list asks the API for. Kept apart from the screens so the addresses can be
// tested without React.

/** Rows per screen in the purchase list: the API's default. */
export const PURCHASE_PAGE_SIZE = 20;

export interface PurchaseFilters {
  /** One status, or every status. */
  status: PurchaseStatus | 'all';
  /** Only this vendor; null means every vendor. */
  vendorId: number | null;
  /** Invoice dates from and to (YYYY-MM-DD, both included); empty means no limit. */
  from: string;
  to: string;
}

/** What the list shows first: every purchase, newest first. */
export const DEFAULT_PURCHASE_FILTERS: PurchaseFilters = {
  status: 'all',
  vendorId: null,
  from: '',
  to: '',
};

/** The API address of one page of purchases under these filters. */
export function purchasesPath(filters: PurchaseFilters, offset: number): string {
  const params = new URLSearchParams({
    limit: String(PURCHASE_PAGE_SIZE),
    offset: String(offset),
  });
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.vendorId !== null) params.set('vendorId', String(filters.vendorId));
  if (filters.from !== '') params.set('from', filters.from);
  if (filters.to !== '') params.set('to', filters.to);
  return `/purchases?${params.toString()}`;
}

/** The counter's exact match for what was scanned or typed: by barcode first, then by code. */
export function itemLookupPaths(text: string): [string, string] {
  const value = encodeURIComponent(text.trim());
  return [`/items/lookup?barcode=${value}`, `/items/lookup?code=${value}`];
}

/** A short list of active items whose name, code or barcode contains the text. */
export function itemSearchPath(text: string, limit = 8): string {
  const params = new URLSearchParams({ search: text.trim(), active: 'true', limit: String(limit) });
  return `/items?${params.toString()}`;
}
