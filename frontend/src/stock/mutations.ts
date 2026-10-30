import type { CreateAdjustmentInput, StockAdjustment } from '@ds/shared';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { catalogKeys } from '../catalog/keys';
import { stockKeys } from './keys';

// A plain options object built from the QueryClient, so tests can run it without React; the
// use… hook below only hands it to useMutation.

/** An adjustment changes stock: refresh the stock screens and the items (they carry stock). */
export const createAdjustmentOptions = (client: QueryClient) => ({
  mutationFn: (input: CreateAdjustmentInput) =>
    api.post<StockAdjustment>('/stock/adjustments', input),
  onSuccess: () =>
    Promise.all([
      client.invalidateQueries({ queryKey: stockKeys.all }),
      client.invalidateQueries({ queryKey: catalogKeys.items }),
    ]),
});

/** Adjust one item's stock with a reason. */
export function useCreateAdjustment() {
  return useMutation(createAdjustmentOptions(useQueryClient()));
}
