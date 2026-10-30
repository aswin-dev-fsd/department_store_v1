import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ITEM_FILTERS } from '../catalog/filters';
import { catalogKeys } from '../catalog/keys';
import { stockKeys } from './keys';
import { createAdjustmentOptions } from './mutations';

const meta = { timestamp: '2026-10-30T00:00:00.000Z', version: '0.1.0' };
let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;

beforeEach(() => {
  client = new QueryClient();
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ success: true, data: { itemId: 7 }, meta }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Seed a cached query so we can tell whether it was marked stale. */
function seed(key: readonly unknown[]) {
  client.setQueryData(key, { items: [] });
  return () => client.getQueryCache().find({ queryKey: key })!.state.isInvalidated;
}

describe('createAdjustmentOptions', () => {
  it('POSTs the adjustment and refreshes the stock lists, the history and the items', async () => {
    const listStale = seed(stockKeys.list({ branchId: null, categoryId: null }, 0));
    const historyStale = seed(stockKeys.movements(7, null, 0));
    const itemsStale = seed(catalogKeys.itemList(DEFAULT_ITEM_FILTERS, 0));

    const input = { itemId: 7, quantity: -2, reason: 'damage' as const };
    const observer = new MutationObserver(client, createAdjustmentOptions(client) as never);
    await observer.mutate(input as never);

    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe('/api/v1/stock/adjustments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect([listStale(), historyStale(), itemsStale()]).toEqual([true, true, true]);
  });
});
