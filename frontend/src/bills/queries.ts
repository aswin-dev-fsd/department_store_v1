import type { Customer } from '@ds/shared';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { billKeys } from './keys';

/**
 * The customer with this phone (10 digits), null when there is none yet; nothing is asked for
 * while `phone` is null. A new customer is created when the bill is saved, not here.
 */
export function useCustomerLookup(phone: string | null) {
  return useQuery({
    queryKey: billKeys.customer(phone ?? ''),
    enabled: phone !== null,
    queryFn: async (): Promise<Customer | null> => {
      try {
        return await api.get<Customer>(`/customers/lookup?phone=${phone}`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
}
