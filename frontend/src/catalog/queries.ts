import { MAX_PAGE_SIZE, type Category, type Item, type Page, type Vendor } from '@ds/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import {
  categoriesPath,
  itemsPath,
  vendorsPath,
  type ItemFilters,
  type VendorFilters,
} from './filters';
import { catalogKeys } from './keys';

/** One page of items under the filters; the previous page stays on screen while the next loads. */
export function useItems(filters: ItemFilters, offset: number) {
  return useQuery({
    queryKey: catalogKeys.itemList(filters, offset),
    queryFn: () => api.get<Page<Item>>(itemsPath(filters, offset)),
    placeholderData: keepPreviousData,
  });
}

/** One page of the branch's categories. */
export function useCategories(offset: number) {
  return useQuery({
    queryKey: catalogKeys.categoryList(offset),
    queryFn: () => api.get<Page<Category>>(categoriesPath(offset)),
    placeholderData: keepPreviousData,
  });
}

/**
 * All the branch's categories for the drop-downs (the API's largest page). Pass `false` when the
 * caller has no branch (an Admin), so no request is made.
 */
export function useCategoryOptions(enabled = true) {
  return useQuery({
    queryKey: catalogKeys.categoryOptions,
    enabled,
    queryFn: async (): Promise<Category[]> => {
      const page = await api.get<Page<Category>>(`/categories?limit=${MAX_PAGE_SIZE}`);
      return page.items;
    },
  });
}

/** One page of vendors under the filters. */
export function useVendors(filters: VendorFilters, offset: number) {
  return useQuery({
    queryKey: catalogKeys.vendorList(filters, offset),
    queryFn: () => api.get<Page<Vendor>>(vendorsPath(filters, offset)),
    placeholderData: keepPreviousData,
  });
}
