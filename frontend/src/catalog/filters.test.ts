import { describe, expect, it } from 'vitest';
import { t } from '../i18n/t';
import {
  categoriesPath,
  CATALOG_PAGE_SIZE,
  DEFAULT_ITEM_FILTERS,
  DEFAULT_VENDOR_FILTERS,
  itemsPath,
  STATUS_OPTIONS,
  vendorsPath,
} from './filters';

describe('itemsPath', () => {
  it('asks for the first page of active items, of every category, by default', () => {
    expect(CATALOG_PAGE_SIZE).toBe(20);
    expect(itemsPath(DEFAULT_ITEM_FILTERS, 0)).toBe('/items?limit=20&offset=0&active=true');
  });

  it('adds the search text, the category and the status, and the page asked for', () => {
    expect(itemsPath({ search: 'rice 10 kg', categoryId: 3, status: 'inactive' }, 40)).toBe(
      '/items?limit=20&offset=40&search=rice+10+kg&categoryId=3&active=false',
    );
  });

  it('sends no status filter for "all", so active and inactive items both come back', () => {
    expect(itemsPath({ search: '', categoryId: null, status: 'all' }, 0)).toBe(
      '/items?limit=20&offset=0',
    );
  });

  it('encodes characters that mean something in an address', () => {
    expect(itemsPath({ search: '100% & more', categoryId: null, status: 'all' }, 0)).toBe(
      '/items?limit=20&offset=0&search=100%25+%26+more',
    );
  });
});

describe('vendorsPath', () => {
  it('asks for the first page of active vendors by default', () => {
    expect(vendorsPath(DEFAULT_VENDOR_FILTERS, 0)).toBe('/vendors?limit=20&offset=0&active=true');
  });

  it('adds the search text and the status, and the page asked for', () => {
    expect(vendorsPath({ search: 'sri traders', status: 'inactive' }, 20)).toBe(
      '/vendors?limit=20&offset=20&search=sri+traders&active=false',
    );
  });

  it('sends no status filter for "all"', () => {
    expect(vendorsPath({ search: '', status: 'all' }, 0)).toBe('/vendors?limit=20&offset=0');
  });
});

describe('categoriesPath', () => {
  it('asks for one page of categories', () => {
    expect(categoriesPath(0)).toBe('/categories?limit=20&offset=0');
    expect(categoriesPath(40)).toBe('/categories?limit=20&offset=40');
  });
});

describe('STATUS_OPTIONS', () => {
  it('offers the three statuses, with labels from the dictionary', () => {
    expect(STATUS_OPTIONS.map((option) => option.value)).toEqual(['active', 'inactive', 'all']);
    expect(STATUS_OPTIONS.map((option) => t(option.label))).toEqual([
      'Active only',
      'Inactive only',
      'Active and inactive',
    ]);
  });
});
