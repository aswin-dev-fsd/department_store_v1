// Query keys for the billing screens. All start with 'bills', so one prefix names the whole area,
// and none start with an auth key, so logging out or switching branch clears them (auth/cache.ts).
export const billKeys = {
  /** Every bill query. */
  all: ['bills'] as const,
  /** A customer looked up by phone on the counter (customers are client-wide). */
  customer: (phone: string) => ['bills', 'customer', phone] as const,
};
