import type { Bill, BillSummary, Customer, Page } from '@ds/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { billKeys } from './keys';
import { billsPath, type BillFilters } from './paths';

/** One page of bills under the filters; the previous page stays up while the next loads. */
export function useBills(filters: BillFilters, offset: number) {
  return useQuery({
    queryKey: billKeys.list(filters, offset),
    queryFn: () => api.get<Page<BillSummary>>(billsPath(filters, offset)),
    placeholderData: keepPreviousData,
  });
}

/** One bill with its lines and payments; nothing is asked for while `id` is null. */
export function useBill(id: number | null) {
  return useQuery({
    queryKey: billKeys.detail(id ?? 0),
    enabled: id !== null,
    queryFn: () => api.get<Bill>(`/bills/${id}`),
  });
}

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
