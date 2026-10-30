import type { CancelPurchaseInput, Purchase, PurchaseDraftInput } from '@ds/shared';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { catalogKeys } from '../catalog/keys';
import { stockKeys } from '../stock/keys';
import { purchaseKeys } from './keys';

// Each mutation is a plain options object built from the QueryClient, so tests can run it
// without React; the use… hooks below only hand it to useMutation.

const refreshPurchases = (client: QueryClient) =>
  client.invalidateQueries({ queryKey: purchaseKeys.all });

/** Posting and cancelling move stock, and posting may change item prices: refresh those too. */
const refreshAfterStockChange = (client: QueryClient) =>
  Promise.all([
    refreshPurchases(client),
    client.invalidateQueries({ queryKey: stockKeys.all }),
    client.invalidateQueries({ queryKey: catalogKeys.items }),
  ]);

export const createPurchaseOptions = (client: QueryClient) => ({
  mutationFn: (input: PurchaseDraftInput) => api.post<Purchase>('/purchases', input),
  onSuccess: () => refreshPurchases(client),
});

export const updatePurchaseOptions = (client: QueryClient) => ({
  mutationFn: ({ id, draft }: { id: number; draft: PurchaseDraftInput }) =>
    api.put<Purchase>(`/purchases/${id}`, draft),
  onSuccess: () => refreshPurchases(client),
});

export const postPurchaseOptions = (client: QueryClient) => ({
  mutationFn: (id: number) => api.post<Purchase>(`/purchases/${id}/post`),
  onSuccess: () => refreshAfterStockChange(client),
});

export const cancelPurchaseOptions = (client: QueryClient) => ({
  mutationFn: ({ id, input }: { id: number; input: CancelPurchaseInput }) =>
    api.post<Purchase>(`/purchases/${id}/cancel`, input),
  onSuccess: () => refreshAfterStockChange(client),
});

/** Save a new draft. */
export function useCreatePurchase() {
  return useMutation(createPurchaseOptions(useQueryClient()));
}

/** Save changes to a draft (the whole draft is replaced). */
export function useUpdatePurchase() {
  return useMutation(updatePurchaseOptions(useQueryClient()));
}

/** Post a saved draft: stock in, prices applied, locked. */
export function usePostPurchase() {
  return useMutation(postPurchaseOptions(useQueryClient()));
}

/** Cancel a posted purchase with a reason. */
export function useCancelPurchase() {
  return useMutation(cancelPurchaseOptions(useQueryClient()));
}
