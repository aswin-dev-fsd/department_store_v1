// What the stock screens ask the API for. Kept apart from the screens so the addresses can be
// tested without React.

/** Rows per screen in the stock list and in an item's history: the API's default. */
export const STOCK_PAGE_SIZE = 20;

export interface StockScope {
  /**
   * The branch to read. An Admin works in no branch and names one; a cashier leaves it null and
   * always reads the branch they are working in.
   */
  branchId: number | null;
  /** Only this category; null means every category. */
  categoryId: number | null;
}

function pagingParams(offset: number): URLSearchParams {
  return new URLSearchParams({ limit: String(STOCK_PAGE_SIZE), offset: String(offset) });
}

/** The API address of one page of the stock list. */
export function stockPath(scope: StockScope, offset: number): string {
  const params = pagingParams(offset);
  if (scope.categoryId !== null) params.set('categoryId', String(scope.categoryId));
  if (scope.branchId !== null) params.set('branchId', String(scope.branchId));
  return `/stock?${params.toString()}`;
}

/** The API address of one page of an item's movement history, newest first. */
export function movementsPath(itemId: number, branchId: number | null, offset: number): string {
  const params = pagingParams(offset);
  if (branchId !== null) params.set('branchId', String(branchId));
  return `/stock/${itemId}/movements?${params.toString()}`;
}
