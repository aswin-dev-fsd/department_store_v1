import type { StockScope } from './paths';

// Query keys for the stock screens. All start with 'stock', so one prefix names a whole area, and
// none start with an auth key, so logging out or switching branch clears them (auth/cache.ts).
export const stockKeys = {
  /** Every stock query: lists and histories. */
  all: ['stock'] as const,
  list: (scope: StockScope, offset: number) => ['stock', 'list', { ...scope, offset }] as const,
  movements: (itemId: number, branchId: number | null, offset: number) =>
    ['stock', 'movements', { itemId, branchId, offset }] as const,
};
