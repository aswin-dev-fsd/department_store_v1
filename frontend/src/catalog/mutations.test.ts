import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ITEM_FILTERS, DEFAULT_VENDOR_FILTERS } from './filters';
import { catalogKeys } from './keys';
import {
  createCategoryOptions,
  createItemOptions,
  createVendorOptions,
  updateCategoryOptions,
  updateItemOptions,
  updateVendorOptions,
} from './mutations';

const meta = { timestamp: '2026-10-10T00:00:00.000Z', version: '0.1.0' };
let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;

/** Answer every request with this data in the success envelope. */
function respondWith(data: unknown, status = 200) {
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ success: true, data, meta }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
}

/** Run one mutation to completion, the way a component's useMutation would. */
function run<TData, TVars>(
  options: Parameters<typeof MutationObserver.prototype.setOptions>[0],
  variables: TVars,
) {
  const observer = new MutationObserver<TData, Error, TVars>(client, options as never);
  return { observer, done: observer.mutate(variables) };
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

function lastRequest() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return {
    url,
    method: init.method,
    body: init.body === undefined ? undefined : JSON.parse(init.body as string),
  };
}

describe('item mutations', () => {
  it('create: POSTs the item and refreshes the item lists only', async () => {
    respondWith({ id: 1 }, 201);
    const itemsStale = seed(catalogKeys.itemList(DEFAULT_ITEM_FILTERS, 0));
    const categoriesStale = seed(catalogKeys.categoryOptions);
    const vendorsStale = seed(catalogKeys.vendorList(DEFAULT_VENDOR_FILTERS, 0));

    const input = {
      code: 'RICE10',
      barcode: null,
      name: 'Rice 10 kg',
      categoryId: 3,
      mrpPaise: 65000,
      sellingPricePaise: 62000,
      reorderLevel: null,
    };
    await run(createItemOptions(client), input).done;

    expect(lastRequest()).toEqual({ url: '/api/v1/items', method: 'POST', body: input });
    expect(itemsStale()).toBe(true);
    expect(categoriesStale()).toBe(false);
    expect(vendorsStale()).toBe(false);
  });

  it('update: PATCHes only the given changes to that item and refreshes the item lists', async () => {
    respondWith({ id: 5 });
    const itemsStale = seed(catalogKeys.itemList(DEFAULT_ITEM_FILTERS, 20));

    await run(updateItemOptions(client), { id: 5, changes: { isActive: false } }).done;

    expect(lastRequest()).toEqual({
      url: '/api/v1/items/5',
      method: 'PATCH',
      body: { isActive: false },
    });
    expect(itemsStale()).toBe(true);
  });
});

describe('category mutations', () => {
  it('create: POSTs the category and refreshes the category lists and drop-downs, not the items', async () => {
    respondWith({ id: 1 }, 201);
    const listStale = seed(catalogKeys.categoryList(0));
    const optionsStale = seed(catalogKeys.categoryOptions);
    const itemsStale = seed(catalogKeys.itemList(DEFAULT_ITEM_FILTERS, 0));

    await run(createCategoryOptions(client), { name: 'Grocery' }).done;

    expect(lastRequest()).toEqual({
      url: '/api/v1/categories',
      method: 'POST',
      body: { name: 'Grocery' },
    });
    expect(listStale()).toBe(true);
    expect(optionsStale()).toBe(true);
    expect(itemsStale()).toBe(false);
  });

  it('rename: PATCHes the new name to that category and refreshes the same queries', async () => {
    respondWith({ id: 3 });
    const listStale = seed(catalogKeys.categoryList(0));
    const optionsStale = seed(catalogKeys.categoryOptions);

    await run(updateCategoryOptions(client), { id: 3, changes: { name: 'Groceries' } }).done;

    expect(lastRequest()).toEqual({
      url: '/api/v1/categories/3',
      method: 'PATCH',
      body: { name: 'Groceries' },
    });
    expect(listStale()).toBe(true);
    expect(optionsStale()).toBe(true);
  });
});

describe('vendor mutations', () => {
  it('create: POSTs the vendor and refreshes the vendor lists only', async () => {
    respondWith({ id: 1 }, 201);
    const vendorsStale = seed(catalogKeys.vendorList(DEFAULT_VENDOR_FILTERS, 0));
    const itemsStale = seed(catalogKeys.itemList(DEFAULT_ITEM_FILTERS, 0));

    const input = { name: 'Sri Traders', phone: null, address: null, gstin: '33ABCDE1234F1Z5' };
    await run(createVendorOptions(client), input).done;

    expect(lastRequest()).toEqual({ url: '/api/v1/vendors', method: 'POST', body: input });
    expect(vendorsStale()).toBe(true);
    expect(itemsStale()).toBe(false);
  });

  it('update: PATCHes the changes to that vendor and refreshes the vendor lists', async () => {
    respondWith({ id: 4 });
    const vendorsStale = seed(catalogKeys.vendorList(DEFAULT_VENDOR_FILTERS, 0));

    await run(updateVendorOptions(client), { id: 4, changes: { phone: '9876543210' } }).done;

    expect(lastRequest()).toEqual({
      url: '/api/v1/vendors/4',
      method: 'PATCH',
      body: { phone: '9876543210' },
    });
    expect(vendorsStale()).toBe(true);
  });
});

describe('catalogKeys', () => {
  it('start with "catalog", so logging out or switching branch clears them (auth/cache.ts)', () => {
    const keys = [
      catalogKeys.items,
      catalogKeys.itemList(DEFAULT_ITEM_FILTERS, 0),
      catalogKeys.categories,
      catalogKeys.categoryList(0),
      catalogKeys.categoryOptions,
      catalogKeys.vendors,
      catalogKeys.vendorList(DEFAULT_VENDOR_FILTERS, 0),
    ];
    for (const key of keys) expect(key[0]).toBe('catalog');
  });

  it('give each filter and page its own list', () => {
    const base = catalogKeys.itemList(DEFAULT_ITEM_FILTERS, 0);
    expect(catalogKeys.itemList(DEFAULT_ITEM_FILTERS, 20)).not.toEqual(base);
    expect(catalogKeys.itemList({ ...DEFAULT_ITEM_FILTERS, search: 'rice' }, 0)).not.toEqual(base);
    expect(catalogKeys.itemList({ ...DEFAULT_ITEM_FILTERS }, 0)).toEqual(base);
  });
});
