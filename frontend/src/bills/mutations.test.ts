import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogKeys } from '../catalog/keys';
import { DEFAULT_ITEM_FILTERS } from '../catalog/filters';
import { stockKeys } from '../stock/keys';
import { billKeys } from './keys';
import { createBillOptions } from './mutations';

const meta = { timestamp: '2026-10-30T00:00:00.000Z', version: '0.1.0' };
let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;

beforeEach(() => {
  client = new QueryClient();
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ success: true, data: { id: 7 }, meta }), {
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

describe('createBillOptions', () => {
  it('POSTs the ids, quantities, discounts and payments, and refreshes bills, stock and items', async () => {
    const billsStale = seed(billKeys.customer('9876543210'));
    const stockStale = seed(stockKeys.list({ branchId: null, categoryId: null }, 0));
    const itemsStale = seed(catalogKeys.itemList(DEFAULT_ITEM_FILTERS, 0));

    const input = {
      lines: [{ itemId: 1, quantity: 2, discountPaise: 0 }],
      payments: [{ mode: 'cash' as const, amountPaise: 29100 }],
      customer: { phone: '9876543210', name: 'Kavya' },
    };
    const observer = new MutationObserver(client, createBillOptions(client) as never);
    await observer.mutate(input as never);

    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe('/api/v1/bills');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect([billsStale(), stockStale(), itemsStale()]).toEqual([true, true, true]);
  });
});
