import type { Page, StockLine, StockMovement } from '@ds/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { stockKeys } from './keys';
import { movementsPath, stockPath, type StockScope } from './paths';

/** One page of the stock list; the previous page stays on screen while the next loads. */
export function useStock(scope: StockScope, offset: number) {
  return useQuery({
    queryKey: stockKeys.list(scope, offset),
    queryFn: () => api.get<Page<StockLine>>(stockPath(scope, offset)),
    placeholderData: keepPreviousData,
  });
}

/** One page of an item's movement history, newest first. */
export function useMovements(itemId: number, branchId: number | null, offset: number) {
  return useQuery({
    queryKey: stockKeys.movements(itemId, branchId, offset),
    queryFn: () => api.get<Page<StockMovement>>(movementsPath(itemId, branchId, offset)),
    placeholderData: keepPreviousData,
  });
}
