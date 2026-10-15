import type { ItemFilters, VendorFilters } from './filters';

// Query keys for the catalog screens. All start with 'catalog', so one prefix names a whole area,
// and none start with an auth key, so logging out or switching branch clears them (auth/cache.ts).
export const catalogKeys = {
  /** Every item query. */
  items: ['catalog', 'items'] as const,
  itemList: (filters: ItemFilters, offset: number) =>
    ['catalog', 'items', 'list', { ...filters, offset }] as const,
  /** Every category query: lists and the drop-down options. */
  categories: ['catalog', 'categories'] as const,
  categoryList: (offset: number) => ['catalog', 'categories', 'list', { offset }] as const,
  /** All the branch's categories (up to the API's largest page), for drop-downs. */
  categoryOptions: ['catalog', 'categories', 'options'] as const,
  /** Every vendor query. */
  vendors: ['catalog', 'vendors'] as const,
  vendorList: (filters: VendorFilters, offset: number) =>
    ['catalog', 'vendors', 'list', { ...filters, offset }] as const,
};
