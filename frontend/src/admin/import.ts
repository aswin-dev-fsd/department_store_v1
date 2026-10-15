import { IMPORT_COLUMNS, type ImportError, type ImportResult } from '@ds/shared';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { catalogKeys } from '../catalog/keys';
import { stockKeys } from '../stock/keys';

/** An import changes a branch's items, categories and stock, wherever they are cached. */
function refreshAfterImport(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: stockKeys.all }),
    client.invalidateQueries({ queryKey: catalogKeys.items }),
    client.invalidateQueries({ queryKey: catalogKeys.categories }),
  ]);
}

// A plain options object built from the QueryClient, so tests can run it without React.
export const importItemsOptions = (client: QueryClient) => ({
  mutationFn: ({ branchId, csv }: { branchId: number; csv: string }) =>
    api.postCsv<ImportResult>(`/admin/branches/${branchId}/import`, csv),
  onSuccess: () => refreshAfterImport(client),
});

/** Import a CSV file's text into a branch. */
export function useImportItems() {
  return useMutation(importItemsOptions(useQueryClient()));
}

/**
 * The problems a refused import lists (422 IMPORT_INVALID: every row, column and message), or
 * null when the failure is anything else. Entries that are not in that shape are skipped.
 */
export function importProblems(error: unknown): ImportError[] | null {
  if (
    !(error instanceof ApiError) ||
    error.code !== 'IMPORT_INVALID' ||
    !Array.isArray(error.details)
  ) {
    return null;
  }
  const problems: ImportError[] = [];
  for (const detail of error.details as unknown[]) {
    if (typeof detail !== 'object' || detail === null) continue;
    const { row, column, message } = detail as { row?: unknown; column?: unknown; message?: unknown };
    if (typeof row !== 'number' || typeof message !== 'string') continue;
    problems.push({ row, column: IMPORT_COLUMNS.find((name) => name === column) ?? null, message });
  }
  return problems.length > 0 ? problems : null;
}
