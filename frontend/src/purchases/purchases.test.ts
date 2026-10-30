import type { Purchase } from '@ds/shared';
import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { catalogKeys } from '../catalog/keys';
import { stockKeys } from '../stock/keys';
import {
  convertEditor,
  emptyEditor,
  lineFromItem,
  lineTotalPaise,
  purchaseToEditor,
  runningTotal,
  serverEditorErrors,
  shortItemNames,
  todayInIndia,
  type EditorLine,
  type EditorValues,
} from './editor';
import { purchaseKeys } from './keys';
import {
  cancelPurchaseOptions,
  createPurchaseOptions,
  postPurchaseOptions,
  updatePurchaseOptions,
} from './mutations';
import {
  DEFAULT_PURCHASE_FILTERS,
  itemLookupPaths,
  itemSearchPath,
  purchasesPath,
} from './paths';

const rice = { id: 7, code: 'R10', name: 'Rice 10 kg' };

function lineWith(overrides: Partial<EditorLine> = {}): EditorLine {
  return { ...lineFromItem(rice), quantity: '12', cost: '450', ...overrides };
}

function editor(overrides: Partial<EditorValues> = {}): EditorValues {
  return {
    vendorId: '3',
    vendorInvoiceNo: 'INV-2231',
    invoiceDate: '2026-10-28',
    notes: '',
    lines: [lineWith()],
    ...overrides,
  };
}

describe('purchasesPath', () => {
  it('asks for the first page of everything by default', () => {
    expect(purchasesPath(DEFAULT_PURCHASE_FILTERS, 0)).toBe('/purchases?limit=20&offset=0');
  });

  it('adds each filter that is set', () => {
    expect(
      purchasesPath({ status: 'draft', vendorId: 3, from: '2026-10-01', to: '2026-10-31' }, 40),
    ).toBe('/purchases?limit=20&offset=40&status=draft&vendorId=3&from=2026-10-01&to=2026-10-31');
  });
});

describe('item lookup paths', () => {
  it('tries the barcode first, then the code, trimmed and escaped', () => {
    expect(itemLookupPaths(' 8901 2&3 ')).toEqual([
      '/items/lookup?barcode=8901%202%263',
      '/items/lookup?code=8901%202%263',
    ]);
  });

  it('searches active items by any text', () => {
    expect(itemSearchPath(' rice ')).toBe('/items?search=rice&active=true&limit=8');
  });
});

describe('todayInIndia', () => {
  it('uses the Indian date, which is already tomorrow late in the UTC evening', () => {
    expect(todayInIndia(new Date('2026-10-30T19:00:00Z'))).toBe('2026-10-31');
    expect(todayInIndia(new Date('2026-10-30T18:00:00Z'))).toBe('2026-10-30');
  });

  it('starts a new draft today, with nothing filled in', () => {
    expect(emptyEditor('2026-10-30')).toEqual({
      vendorId: '',
      vendorInvoiceNo: '',
      invoiceDate: '2026-10-30',
      notes: '',
      lines: [],
    });
  });
});

describe('lines and totals', () => {
  it('gives each new line its own key and empty boxes', () => {
    const a = lineFromItem(rice);
    const b = lineFromItem(rice);
    expect(a.key).not.toBe(b.key);
    expect(a).toMatchObject({ itemId: 7, quantity: '', cost: '', newMrp: '', newSellingPrice: '' });
  });

  it('works out a line total once the quantity and cost are numbers', () => {
    expect(lineTotalPaise({ quantity: '12', cost: '450.50' })).toBe(540600);
    expect(lineTotalPaise({ quantity: '', cost: '450' })).toBeNull();
    expect(lineTotalPaise({ quantity: '1.5', cost: '450' })).toBeNull();
    expect(lineTotalPaise({ quantity: '2', cost: 'abc' })).toBeNull();
  });

  it('adds the complete lines and counts the rest', () => {
    expect(
      runningTotal([lineWith(), lineWith({ quantity: '1', cost: '0.99' }), lineWith({ cost: '' })]),
    ).toEqual({ totalPaise: 540099, incomplete: 1 });
    expect(runningTotal([])).toEqual({ totalPaise: 0, incomplete: 0 });
  });
});

describe('purchaseToEditor', () => {
  it('turns a saved draft back into text, prices in rupees', () => {
    const purchase = {
      vendor: { id: 3, name: 'Sri Traders' },
      vendorInvoiceNo: 'INV-2231',
      invoiceDate: '2026-10-28',
      notes: null,
      lines: [
        {
          id: 1,
          itemId: 7,
          itemCode: 'R10',
          itemName: 'Rice 10 kg',
          quantity: 12,
          costPricePaise: 45050,
          newMrpPaise: 52000,
          newSellingPricePaise: null,
          lineTotalPaise: 540600,
        },
      ],
    } as unknown as Purchase;

    expect(purchaseToEditor(purchase)).toMatchObject({
      vendorId: '3',
      notes: '',
      lines: [{ itemId: 7, quantity: '12', cost: '450.50', newMrp: '520.00', newSellingPrice: '' }],
    });
  });
});

describe('convertEditor', () => {
  it('turns the editor into the API draft, rupees into paise, blanks into none', () => {
    const result = convertEditor(
      editor({ notes: ' ', lines: [lineWith({ cost: '450.50', newSellingPrice: '499' })] }),
    );
    expect(result).toEqual({
      ok: true,
      draft: {
        vendorId: 3,
        vendorInvoiceNo: 'INV-2231',
        invoiceDate: '2026-10-28',
        notes: null,
        lines: [
          {
            itemId: 7,
            quantity: 12,
            costPricePaise: 45050,
            newMrpPaise: null,
            newSellingPricePaise: 49900,
          },
        ],
      },
    });
  });

  it('accepts a draft with no lines (saved part-way)', () => {
    expect(convertEditor(editor({ lines: [] })).ok).toBe(true);
  });

  it('names each box at fault, line by line, in plain words', () => {
    const result = convertEditor(
      editor({
        vendorId: '',
        vendorInvoiceNo: ' ',
        lines: [
          lineWith(),
          lineWith({ quantity: 'two', cost: '' }),
          lineWith({ quantity: '0', newMrp: '12.345' }),
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toMatchObject({
      vendorId: expect.any(String),
      vendorInvoiceNo: expect.any(String),
      'lines.1.quantity': 'Enter a whole number of packs, like 12.',
      'lines.1.cost': 'Enter the cost price.',
      'lines.2.quantity': 'Enter at least 1',
      'lines.2.newMrp': 'Write the price in rupees, like 145.50.',
    });
    expect(Object.keys(result.errors).some((key) => key.startsWith('lines.0.'))).toBe(false);
  });
});

describe('server problems', () => {
  it('puts a draft save’s 422 and a post’s 422 under the editor’s own field names', () => {
    const error = new ApiError('VALIDATION_ERROR', 'Invalid', 422, [
      { path: 'body.vendorId', message: 'Choose a vendor' },
      { path: 'body.lines.2.itemId', message: 'Choose an active item' },
      { path: 'lines.0.newSellingPricePaise', message: 'Selling price cannot be above the MRP' },
    ]);
    expect(serverEditorErrors(error)).toEqual({
      vendorId: 'Choose a vendor',
      'lines.2.item': 'Choose an active item',
      'lines.0.newSellingPrice': 'Selling price cannot be above the MRP',
    });
    expect(serverEditorErrors(new Error('x'))).toEqual({});
  });

  it('names the items a refused cancel says are already sold', () => {
    const error = new ApiError('INSUFFICIENT_STOCK', 'Not enough', 400, [
      { itemId: 7, name: 'Rice 10 kg', available: 7, requested: 10 },
    ]);
    expect(shortItemNames(error)).toEqual(['Rice 10 kg']);
    expect(shortItemNames(new ApiError('DOCUMENT_LOCKED', 'Locked', 400))).toEqual([]);
  });
});

describe('mutations', () => {
  const meta = { timestamp: '2026-10-30T00:00:00.000Z', version: '0.1.0' };
  let fetchMock: ReturnType<typeof vi.fn>;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function respond() {
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, data: { id: 5 }, meta }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
  }

  async function run<V>(
    build: (client: QueryClient) => { mutationFn: (v: V) => Promise<unknown> },
    variables: V,
  ) {
    respond();
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await new MutationObserver(client, build(client) as never).mutate(variables as never);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const refreshed = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    return { url, method: init.method, body: init.body, refreshed };
  }

  const draft = {
    vendorId: 3,
    vendorInvoiceNo: 'INV-1',
    invoiceDate: '2026-10-28',
    lines: [],
  };

  it('creates and edits drafts, refreshing only the purchases', async () => {
    const created = await run(createPurchaseOptions, draft);
    expect(created).toMatchObject({ url: '/api/v1/purchases', method: 'POST' });
    expect(created.refreshed).toEqual([purchaseKeys.all]);

    const edited = await run(updatePurchaseOptions, { id: 5, draft });
    expect(edited).toMatchObject({ url: '/api/v1/purchases/5', method: 'PUT' });
    expect(edited.refreshed).toEqual([purchaseKeys.all]);
  });

  it('posts and cancels, refreshing purchases, stock and items (prices may change)', async () => {
    const posted = await run(postPurchaseOptions, 5);
    expect(posted).toMatchObject({ url: '/api/v1/purchases/5/post', method: 'POST' });
    expect(posted.refreshed).toEqual([purchaseKeys.all, stockKeys.all, catalogKeys.items]);

    const cancelled = await run(cancelPurchaseOptions, { id: 5, input: { reason: 'Wrong' } });
    expect(cancelled).toMatchObject({ url: '/api/v1/purchases/5/cancel', method: 'POST' });
    expect(JSON.parse(String(cancelled.body))).toEqual({ reason: 'Wrong' });
    expect(cancelled.refreshed).toEqual([purchaseKeys.all, stockKeys.all, catalogKeys.items]);
  });
});
