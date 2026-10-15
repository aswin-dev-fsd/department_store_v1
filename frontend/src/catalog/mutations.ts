import type {
  Category,
  CreateCategoryInput,
  CreateItemInput,
  CreateVendorInput,
  Item,
  UpdateCategoryInput,
  UpdateItemInput,
  UpdateVendorInput,
  Vendor,
} from '@ds/shared';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { catalogKeys } from './keys';

// Each mutation is a plain options object built from the QueryClient, so tests can run it
// without React; the use… hooks below only hand it to useMutation.

const refreshItems = (client: QueryClient) =>
  client.invalidateQueries({ queryKey: catalogKeys.items });

// A category's name appears in the item drop-downs and filters, which read the same key family
const refreshCategories = (client: QueryClient) =>
  client.invalidateQueries({ queryKey: catalogKeys.categories });

const refreshVendors = (client: QueryClient) =>
  client.invalidateQueries({ queryKey: catalogKeys.vendors });

export const createItemOptions = (client: QueryClient) => ({
  mutationFn: (input: CreateItemInput) => api.post<Item>('/items', input),
  onSuccess: () => refreshItems(client),
});

export const updateItemOptions = (client: QueryClient) => ({
  mutationFn: ({ id, changes }: { id: number; changes: UpdateItemInput }) =>
    api.patch<Item>(`/items/${id}`, changes),
  onSuccess: () => refreshItems(client),
});

export const createCategoryOptions = (client: QueryClient) => ({
  mutationFn: (input: CreateCategoryInput) => api.post<Category>('/categories', input),
  onSuccess: () => refreshCategories(client),
});

export const updateCategoryOptions = (client: QueryClient) => ({
  mutationFn: ({ id, changes }: { id: number; changes: UpdateCategoryInput }) =>
    api.patch<Category>(`/categories/${id}`, changes),
  onSuccess: () => refreshCategories(client),
});

export const createVendorOptions = (client: QueryClient) => ({
  mutationFn: (input: CreateVendorInput) => api.post<Vendor>('/vendors', input),
  onSuccess: () => refreshVendors(client),
});

export const updateVendorOptions = (client: QueryClient) => ({
  mutationFn: ({ id, changes }: { id: number; changes: UpdateVendorInput }) =>
    api.patch<Vendor>(`/vendors/${id}`, changes),
  onSuccess: () => refreshVendors(client),
});

/** Create an item (and, on the server, its stock row at 0). */
export function useCreateItem() {
  return useMutation(createItemOptions(useQueryClient()));
}

/** Edit an item, or deactivate or reactivate it (`isActive`). */
export function useUpdateItem() {
  return useMutation(updateItemOptions(useQueryClient()));
}

/** Create a category. */
export function useCreateCategory() {
  return useMutation(createCategoryOptions(useQueryClient()));
}

/** Rename a category. */
export function useUpdateCategory() {
  return useMutation(updateCategoryOptions(useQueryClient()));
}

/** Create a vendor. */
export function useCreateVendor() {
  return useMutation(createVendorOptions(useQueryClient()));
}

/** Edit a vendor, or deactivate or reactivate it (`isActive`). */
export function useUpdateVendor() {
  return useMutation(updateVendorOptions(useQueryClient()));
}
