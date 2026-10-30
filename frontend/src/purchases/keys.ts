import type { PurchaseFilters } from './paths';

// Query keys for the purchase screens. All start with 'purchases', so one prefix names the whole
// area, and none start with an auth key, so logging out or switching branch clears them
// (auth/cache.ts).
export const purchaseKeys = {
  /** Every purchase query: lists and single purchases. */
  all: ['purchases'] as const,
  list: (filters: PurchaseFilters, offset: number) =>
    ['purchases', 'list', { ...filters, offset }] as const,
  detail: (id: number) => ['purchases', 'detail', id] as const,
  /** The branch's active vendors, for the editor's and the list's vendor choice. */
  vendorOptions: ['purchases', 'vendor-options'] as const,
};
