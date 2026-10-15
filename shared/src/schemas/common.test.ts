import { describe, expect, it } from 'vitest';
import { activeFilterSchema, idParamSchema, optionalText, searchTextSchema } from './common.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, paginationSchema } from './pagination.js';
import { z } from 'zod';

describe('idParamSchema', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    ['9007199254740', 9007199254740],
  ])('reads %j as %i', (text, id) => {
    expect(idParamSchema.parse({ id: text })).toEqual({ id });
  });

  it.each(['0', '-1', '1.5', '1e3', '0x10', ' 5', '5 ', '', 'abc', '1'.repeat(16)])(
    'refuses %j',
    (text) => {
      expect(idParamSchema.safeParse({ id: text }).success).toBe(false);
    },
  );
});

describe('optionalText', () => {
  const schema = z.object({ note: optionalText(5) });

  it('trims, and turns an empty or blank value into null so a field can be cleared', () => {
    expect(schema.parse({ note: '  hi ' })).toEqual({ note: 'hi' });
    expect(schema.parse({ note: '' })).toEqual({ note: null });
    expect(schema.parse({ note: '   ' })).toEqual({ note: null });
    expect(schema.parse({ note: null })).toEqual({ note: null });
  });

  it('leaves an absent field absent', () => {
    expect(schema.parse({})).toEqual({});
  });

  it('refuses text over the limit', () => {
    expect(schema.safeParse({ note: '123456' }).success).toBe(false);
    expect(schema.safeParse({ note: '12345' }).success).toBe(true);
  });
});

describe('searchTextSchema', () => {
  const schema = z.object({ search: searchTextSchema });

  it('trims the text, and treats a blank search as no search', () => {
    expect(schema.parse({ search: '  rice ' })).toEqual({ search: 'rice' });
    expect(schema.parse({ search: '   ' }).search).toBeUndefined();
    expect(schema.parse({ search: '' }).search).toBeUndefined();
  });

  it('leaves an absent search absent', () => {
    expect(schema.parse({})).toEqual({});
  });

  it('allows 100 characters and refuses more', () => {
    expect(schema.safeParse({ search: 's'.repeat(100) }).success).toBe(true);
    expect(schema.safeParse({ search: 's'.repeat(101) }).success).toBe(false);
  });
});

describe('activeFilterSchema', () => {
  const schema = z.object({ active: activeFilterSchema });

  it('reads true and false from query-string text', () => {
    expect(schema.parse({ active: 'true' })).toEqual({ active: true });
    expect(schema.parse({ active: 'false' })).toEqual({ active: false });
  });

  it('leaves an absent filter absent, which means both', () => {
    expect(schema.parse({})).toEqual({});
  });

  it.each(['maybe', 'TRUE', '1', '0', ''])('refuses %j', (value) => {
    expect(schema.safeParse({ active: value }).success).toBe(false);
  });
});

describe('paginationSchema', () => {
  it(`defaults to limit ${DEFAULT_PAGE_SIZE} and offset 0`, () => {
    expect(paginationSchema.parse({})).toEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  });

  it('reads limit and offset from query-string text', () => {
    expect(paginationSchema.parse({ limit: '5', offset: '40' })).toEqual({ limit: 5, offset: 40 });
  });

  it(`accepts the limits 1 and ${MAX_PAGE_SIZE}`, () => {
    expect(paginationSchema.parse({ limit: '1' }).limit).toBe(1);
    expect(paginationSchema.parse({ limit: String(MAX_PAGE_SIZE) }).limit).toBe(MAX_PAGE_SIZE);
  });

  it.each([
    ['limit', '0'],
    ['limit', String(MAX_PAGE_SIZE + 1)],
    ['limit', '-5'],
    ['limit', 'abc'],
    ['limit', '1.5'],
    ['limit', '1e1'],
    ['limit', ''],
    ['offset', '-1'],
    ['offset', 'x'],
  ])('refuses %s=%j', (field, value) => {
    expect(paginationSchema.safeParse({ [field]: value }).success).toBe(false);
  });
});
