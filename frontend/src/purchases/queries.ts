import {
  MAX_PAGE_SIZE,
  type Page,
  type Purchase,
  type PurchaseSummary,
  type Vendor,
} from '@ds/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { purchaseKeys } from './keys';
import { purchasesPath, type PurchaseFilters } from './paths';

/** One page of purchases under the filters; the previous page stays up while the next loads. */
export function usePurchases(filters: PurchaseFilters, offset: number) {
  return useQuery({
    queryKey: purchaseKeys.list(filters, offset),
    queryFn: () => api.get<Page<PurchaseSummary>>(purchasesPath(filters, offset)),
    placeholderData: keepPreviousData,
  });
}

/** One purchase with its lines; nothing is asked for while `id` is null (a new draft). */
export function usePurchase(id: number | null) {
  return useQuery({
    queryKey: purchaseKeys.detail(id ?? 0),
    enabled: id !== null,
    queryFn: () => api.get<Purchase>(`/purchases/${id}`),
  });
}

/** The branch's active vendors by name (the API's largest page), for choosing one. */
export function useVendorOptions() {
  return useQuery({
    queryKey: purchaseKeys.vendorOptions,
    queryFn: async (): Promise<Vendor[]> => {
      const page = await api.get<Page<Vendor>>(`/vendors?active=true&limit=${MAX_PAGE_SIZE}`);
      return page.items;
    },
  });
}
