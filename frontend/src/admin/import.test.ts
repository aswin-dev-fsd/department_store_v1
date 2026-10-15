import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { DEFAULT_ITEM_FILTERS } from '../catalog/filters';
import { catalogKeys } from '../catalog/keys';
import { stockKeys } from '../stock/keys';
import { importItemsOptions, importProblems } from './import';

const meta = { timestamp: '2026-10-10T00:00:00.000Z', version: '0.1.0' };
let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;

function respondWith(data: unknown, status = 201) {
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ success: true, data, meta }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
}

/** Seed a cached query so we can tell whether it was marked stale. */
function seed(key: readonly unknown[]) {
  client.setQueryData(key, { items: [] });
  return () => client.getQueryCache().find({ queryKey: key })!.state.isInvalidated;
}

beforeEach(() => {
  client = new QueryClient();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('importItemsOptions', () => {
  const result = { categoriesCreated: 3, itemsCreated: 5, openingMovements: 3 };
  const csv = 'code,name\nA1,"Rice, 10 kg"\n';

  it('POSTs the file as it is, as text/csv, to that branch, and answers the counts', async () => {
    respondWith(result);
    const observer = new MutationObserver(client, importItemsOptions(client));

    await expect(observer.mutate({ branchId: 3, csv })).resolves.toEqual(result);

    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe('/api/v1/admin/branches/3/import');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(csv);
    expect(init.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'text/csv' });
  });

  it('refreshes the stock lists, the item lists and the categories, and nothing else', async () => {
    respondWith(result);
    const stockStale = seed(stockKeys.list({ branchId: 3, categoryId: null }, 0));
    const historyStale = seed(stockKeys.movements(7, 3, 0));
    const itemsStale = seed(catalogKeys.itemList(DEFAULT_ITEM_FILTERS, 0));
    const categoriesStale = seed(catalogKeys.categoryOptions);
    const vendorsStale = seed(catalogKeys.vendors);

    await new MutationObserver(client, importItemsOptions(client)).mutate({ branchId: 3, csv });

    expect(stockStale()).toBe(true);
    expect(historyStale()).toBe(true);
    expect(itemsStale()).toBe(true);
    expect(categoriesStale()).toBe(true);
    expect(vendorsStale()).toBe(false);
  });
});

describe('importProblems', () => {
  const refused = (details: unknown, code = 'IMPORT_INVALID') =>
    new ApiError(code, 'The file has problems; nothing was imported', 422, details);

  it('reads the row, column and message of every problem', () => {
    expect(
      importProblems(
        refused([
          { row: 3, column: 'mrp', message: 'Write the price in rupees like 145.50' },
          { row: 7, column: 'code', message: 'Code "DUP1" is also used on row 6' },
        ]),
      ),
    ).toEqual([
      { row: 3, column: 'mrp', message: 'Write the price in rupees like 145.50' },
      { row: 7, column: 'code', message: 'Code "DUP1" is also used on row 6' },
    ]);
  });

  it('keeps a problem with the whole row or file, whose column is null', () => {
    expect(importProblems(refused([{ row: 1, column: null, message: 'The file is empty' }]))).toEqual([
      { row: 1, column: null, message: 'The file is empty' },
    ]);
  });

  it('treats a column it does not know as the whole row', () => {
    expect(importProblems(refused([{ row: 2, column: 'colour', message: 'Odd' }]))).toEqual([
      { row: 2, column: null, message: 'Odd' },
    ]);
  });

  it('skips entries that are not in the shape, and gives nothing when none is', () => {
    expect(
      importProblems(
        refused([
          'text',
          null,
          { row: 'x', column: 'mrp', message: 'Bad row' },
          { row: 4, column: 'mrp' },
          { row: 5, column: 'name', message: 'Enter the item name' },
        ]),
      ),
    ).toEqual([{ row: 5, column: 'name', message: 'Enter the item name' }]);
    expect(importProblems(refused(['text', null]))).toBeNull();
    expect(importProblems(refused([]))).toBeNull();
  });

  it('is null for any other failure', () => {
    expect(importProblems(refused(undefined))).toBeNull();
    expect(importProblems(refused({ row: 1 }))).toBeNull();
    expect(importProblems(refused([{ row: 1, column: null, message: 'x' }], 'IMPORT_CONFLICT'))).toBeNull();
    expect(importProblems(new Error('boom'))).toBeNull();
    expect(importProblems(undefined)).toBeNull();
  });
});
