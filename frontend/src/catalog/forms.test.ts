import {
  createItemSchema,
  createVendorSchema,
  SELLING_ABOVE_MRP_MESSAGE,
  updateItemSchema,
  updateVendorSchema,
  type Item,
  type Vendor,
} from '@ds/shared';
import { describe, expect, it } from 'vitest';
import { validateForm } from '../forms/fieldErrors';
import { t } from '../i18n/t';
import {
  convertItemForm,
  EMPTY_ITEM_FORM,
  EMPTY_VENDOR_FORM,
  itemToForm,
  paiseToInput,
  parseRupees,
  toFormFields,
  vendorToForm,
  type ItemFormValues,
} from './forms';

const item: Item = {
  id: 7,
  code: 'RICE10',
  barcode: '8901234567890',
  name: 'Rice 10 kg',
  categoryId: 3,
  mrpPaise: 65000,
  sellingPricePaise: 62000,
  reorderLevel: 5,
  isActive: true,
  stock: 24,
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
};

const filled: ItemFormValues = {
  code: ' RICE10 ',
  barcode: '',
  name: ' Rice 10 kg ',
  categoryId: '3',
  mrp: '650.00',
  sellingPrice: '620',
  reorderLevel: '5',
};

describe('paiseToInput', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [100, '1.00'],
    [62000, '620.00'],
    [18550, '185.50'],
    [1_000_000_000, '10000000.00'],
  ])('writes %i paise as %j rupees', (paise, text) => {
    expect(paiseToInput(paise)).toBe(text);
  });

  it('reads back as the same paise', () => {
    for (const paise of [0, 1, 99, 100, 101, 4250, 65000, 123456789]) {
      expect(parseRupees(paiseToInput(paise))).toBe(paise);
    }
  });
});

describe('parseRupees', () => {
  it.each([
    ['145.50', 14550],
    [' 99 ', 9900],
    ['0', 0],
    ['0.5', 50],
  ])('reads %j as %i paise', (text, paise) => {
    expect(parseRupees(text)).toBe(paise);
  });

  it.each(['', '   ', 'abc', '1,200.00', '₹100', '-5', '12.345', '1e3'])(
    'does not read %j as an amount',
    (text) => {
      expect(parseRupees(text)).toBeNull();
    },
  );
});

describe('itemToForm', () => {
  it('turns an item into the text its form shows: prices in rupees, ids as text', () => {
    expect(itemToForm(item)).toEqual({
      code: 'RICE10',
      barcode: '8901234567890',
      name: 'Rice 10 kg',
      categoryId: '3',
      mrp: '650.00',
      sellingPrice: '620.00',
      reorderLevel: '5',
    });
  });

  it('turns missing optional values into empty text so inputs stay controlled', () => {
    expect(itemToForm({ ...item, barcode: null, categoryId: null, reorderLevel: null })).toMatchObject(
      { barcode: '', categoryId: '', reorderLevel: '' },
    );
  });

  it('comes back from the form as the same item data, through the update schema', () => {
    const { input, problems } = convertItemForm(itemToForm(item));
    expect(problems).toEqual({});
    expect(validateForm(updateItemSchema, input)).toEqual({
      ok: true,
      data: {
        code: 'RICE10',
        barcode: '8901234567890',
        name: 'Rice 10 kg',
        categoryId: 3,
        mrpPaise: 65000,
        sellingPricePaise: 62000,
        reorderLevel: 5,
      },
    });
  });
});

describe('convertItemForm', () => {
  it('turns rupees into paise and blank optional cells into null, for the create schema', () => {
    const { input, problems } = convertItemForm({ ...filled, categoryId: '', reorderLevel: '' });
    expect(problems).toEqual({});
    expect(validateForm(createItemSchema, input)).toEqual({
      ok: true,
      data: {
        code: 'RICE10',
        barcode: null,
        name: 'Rice 10 kg',
        categoryId: null,
        mrpPaise: 65000,
        sellingPricePaise: 62000,
        reorderLevel: null,
      },
    });
  });

  it('an empty form fails on the code, the name and both prices, and asks for the prices', () => {
    const { input, problems } = convertItemForm(EMPTY_ITEM_FORM);
    expect(problems).toEqual({
      mrp: t('items.priceRequired'),
      sellingPrice: t('items.priceRequired'),
    });
    const result = validateForm(createItemSchema, input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(toFormFields(result.errors)).sort()).toEqual([
        'code',
        'mrp',
        'name',
        'sellingPrice',
      ]);
    }
  });

  it.each(['abc', '1,200.00', '₹100', '-5', '12.345'])(
    'says how to write a price when %j is typed, and leaves the schema to refuse it',
    (text) => {
      const { input, problems } = convertItemForm({ ...filled, mrp: text, sellingPrice: text });
      expect(problems).toEqual({
        mrp: t('items.priceFormat'),
        sellingPrice: t('items.priceFormat'),
      });
      expect(Number.isNaN(input.mrpPaise)).toBe(true);
      expect(Number.isNaN(input.sellingPricePaise)).toBe(true);
      expect(validateForm(createItemSchema, input).ok).toBe(false);
    },
  );

  it('refuses a selling price above the MRP, next to the selling price field', () => {
    const { input, problems } = convertItemForm({ ...filled, mrp: '100', sellingPrice: '100.01' });
    expect(problems).toEqual({});
    const result = validateForm(createItemSchema, input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(toFormFields(result.errors)).toEqual({ sellingPrice: SELLING_ABOVE_MRP_MESSAGE });
    }
  });

  it('accepts a selling price equal to the MRP', () => {
    const { input } = convertItemForm({ ...filled, mrp: '100', sellingPrice: '100.00' });
    expect(validateForm(createItemSchema, input).ok).toBe(true);
  });

  it.each([
    ['', null],
    ['  ', null],
    ['0', 0],
    [' 12 ', 12],
  ])('reads the reorder level %j as %j', (text, expected) => {
    const { input, problems } = convertItemForm({ ...filled, reorderLevel: text });
    expect(problems).toEqual({});
    expect(input.reorderLevel).toBe(expected);
  });

  it.each(['5.5', '-1', 'abc', '1e3', '12345678901'])(
    'says a reorder level of %j is not a whole number',
    (text) => {
      const { input, problems } = convertItemForm({ ...filled, reorderLevel: text });
      expect(problems).toEqual({ reorderLevel: t('items.reorderFormat') });
      expect(Number.isNaN(input.reorderLevel)).toBe(true);
    },
  );
});

describe('toFormFields', () => {
  it("names the prices as the form does, and leaves the other fields' names alone", () => {
    expect(
      toFormFields({
        code: 'a',
        mrpPaise: 'b',
        sellingPricePaise: 'c',
        categoryId: 'd',
      }),
    ).toEqual({ code: 'a', mrp: 'b', sellingPrice: 'c', categoryId: 'd' });
    expect(toFormFields({})).toEqual({});
  });
});

describe('vendor form', () => {
  const vendor: Vendor = {
    id: 4,
    name: 'Sri Traders',
    phone: null,
    address: null,
    gstin: '33ABCDE1234F1Z5',
    isActive: true,
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
  };

  it('turns missing optional values into empty text so inputs stay controlled', () => {
    expect(vendorToForm(vendor)).toEqual({
      name: 'Sri Traders',
      phone: '',
      address: '',
      gstin: '33ABCDE1234F1Z5',
    });
  });

  it('an empty form fails on the name only', () => {
    const result = validateForm(createVendorSchema, EMPTY_VENDOR_FORM);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(['name']);
  });

  it('a filled form is accepted: the GSTIN is upper-cased and blanks become null', () => {
    expect(
      validateForm(createVendorSchema, {
        name: ' Sri Traders ',
        phone: '',
        address: ' ',
        gstin: '33abcde1234f1z5',
      }),
    ).toEqual({
      ok: true,
      data: { name: 'Sri Traders', phone: null, address: null, gstin: '33ABCDE1234F1Z5' },
    });
  });

  it('a GSTIN of the wrong shape is refused next to the GSTIN field', () => {
    const result = validateForm(updateVendorSchema, {
      ...vendorToForm(vendor),
      gstin: '33ABCDE1234F1Z',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(['gstin']);
  });

  it('an unchanged edit form is accepted by the update schema', () => {
    expect(validateForm(updateVendorSchema, vendorToForm(vendor)).ok).toBe(true);
  });
});
