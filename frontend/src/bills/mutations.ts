import type { Bill, CreateBillInput } from '@ds/shared';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { catalogKeys } from '../catalog/keys';
import { stockKeys } from '../stock/keys';
import { billKeys } from './keys';

// A plain options object built from the QueryClient, so tests can run it without React; the
// use… hook below only hands it to useMutation.

/** A saved bill moves stock and may create a customer: refresh bills, stock and items. */
export const createBillOptions = (client: QueryClient) => ({
  mutationFn: (input: CreateBillInput) => api.post<Bill>('/bills', input),
  onSuccess: () =>
    Promise.all([
      client.invalidateQueries({ queryKey: billKeys.all }),
      client.invalidateQueries({ queryKey: stockKeys.all }),
      client.invalidateQueries({ queryKey: catalogKeys.items }),
    ]),
});

/** Save a bill from the counter. */
export function useCreateBill() {
  return useMutation(createBillOptions(useQueryClient()));
}
