import { describe, expect, it } from 'vitest';
import { idParamSchema, optionalText } from './common.js';
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
