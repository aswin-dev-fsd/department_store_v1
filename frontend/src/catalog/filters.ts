import type { MessageKey } from '../i18n/en';

// What the catalog lists ask the API for. Kept apart from the screens so the addresses can be
// tested without React.

/** Rows per screen in the catalog lists: the API's default (its maximum is 100). */
export const CATALOG_PAGE_SIZE = 20;

export type StatusFilter = 'active' | 'inactive' | 'all';

/** The choices of the "Show" drop-down, with their labels. */
export const STATUS_OPTIONS: readonly { value: StatusFilter; label: MessageKey }[] = [
  { value: 'active', label: 'catalog.statusActive' },
  { value: 'inactive', label: 'catalog.statusInactive' },
  { value: 'all', label: 'catalog.statusAll' },
];

export interface ItemFilters {
  /** Text to find in the name, code or barcode; empty means no search. */
  search: string;
  /** Only this category; null means every category. */
  categoryId: number | null;
  status: StatusFilter;
}

/** What the Items screen shows first: the active items of every category. */
export const DEFAULT_ITEM_FILTERS: ItemFilters = { search: '', categoryId: null, status: 'active' };

export interface VendorFilters {
  /** Text to find in the name; empty means no search. */
  search: string;
  status: StatusFilter;
}

/** What the Vendors screen shows first: the active vendors. */
export const DEFAULT_VENDOR_FILTERS: VendorFilters = { search: '', status: 'active' };

function pagingParams(offset: number): URLSearchParams {
  return new URLSearchParams({ limit: String(CATALOG_PAGE_SIZE), offset: String(offset) });
}

/** `active=true|false` for the two statuses that filter; "all" sends nothing. */
function addStatus(params: URLSearchParams, status: StatusFilter): void {
  if (status !== 'all') params.set('active', status === 'active' ? 'true' : 'false');
}

/** The API address of one page of items under these filters. */
export function itemsPath(filters: ItemFilters, offset: number): string {
  const params = pagingParams(offset);
  if (filters.search !== '') params.set('search', filters.search);
  if (filters.categoryId !== null) params.set('categoryId', String(filters.categoryId));
  addStatus(params, filters.status);
  return `/items?${params.toString()}`;
}

/** The API address of one page of vendors under these filters. */
export function vendorsPath(filters: VendorFilters, offset: number): string {
  const params = pagingParams(offset);
  if (filters.search !== '') params.set('search', filters.search);
  addStatus(params, filters.status);
  return `/vendors?${params.toString()}`;
}

/** The API address of one page of categories. */
export function categoriesPath(offset: number): string {
  return `/categories?${pagingParams(offset).toString()}`;
}
