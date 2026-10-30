import type { Bill, CancelBillInput, CreateBillInput } from '@ds/shared';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { catalogKeys } from '../catalog/keys';
import { stockKeys } from '../stock/keys';
import { billKeys } from './keys';

// Each mutation is a plain options object built from the QueryClient, so tests can run it
// without React; the use… hooks below only hand it to useMutation.

/** Saving and cancelling move stock (and saving may create a customer): refresh those too. */
const refreshAfterStockChange = (client: QueryClient) =>
  Promise.all([
    client.invalidateQueries({ queryKey: billKeys.all }),
    client.invalidateQueries({ queryKey: stockKeys.all }),
    client.invalidateQueries({ queryKey: catalogKeys.items }),
  ]);

export const createBillOptions = (client: QueryClient) => ({
  mutationFn: (input: CreateBillInput) => api.post<Bill>('/bills', input),
  onSuccess: () => refreshAfterStockChange(client),
});

export const cancelBillOptions = (client: QueryClient) => ({
  mutationFn: ({ id, input }: { id: number; input: CancelBillInput }) =>
    api.post<Bill>(`/bills/${id}/cancel`, input),
  onSuccess: () => refreshAfterStockChange(client),
});

/** Save a bill from the counter. */
export function useCreateBill() {
  return useMutation(createBillOptions(useQueryClient()));
}

/** Cancel a saved bill with a reason; its stock goes back. */
export function useCancelBill() {
  return useMutation(cancelBillOptions(useQueryClient()));
}
