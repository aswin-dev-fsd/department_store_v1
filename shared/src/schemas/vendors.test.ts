import { describe, expect, it } from 'vitest';
import {
  createVendorSchema,
  GSTIN_PATTERN,
  gstinSchema,
  listVendorsQuerySchema,
  updateVendorSchema,
  vendorNameSchema,
} from './vendors.js';

const GSTIN = '33ABCDE1234F1Z5';

function firstIssuePath(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}) {
  return result.error?.issues[0]?.path.join('.');
}

describe('vendorNameSchema', () => {
  it('trims the name and keeps its case and any script', () => {
    expect(vendorNameSchema.parse('  Sri Traders ')).toBe('Sri Traders');
    expect(vendorNameSchema.parse('ஸ்ரீ டிரேடர்ஸ்')).toBe('ஸ்ரீ டிரேடர்ஸ்');
  });

  it('refuses a blank name', () => {
    expect(vendorNameSchema.safeParse('').success).toBe(false);
    expect(vendorNameSchema.safeParse('   ').success).toBe(false);
  });

  it('allows up to 100 characters and refuses more', () => {
    expect(vendorNameSchema.safeParse('n'.repeat(100)).success).toBe(true);
    expect(vendorNameSchema.safeParse('n'.repeat(101)).success).toBe(false);
  });
});

describe('GSTIN_PATTERN', () => {
  it.each([GSTIN, '29AAAAA0000A1Z5', '07ABCDE1234FAZ9', '33ABCDE1234F9ZA'])(
    'matches %s',
    (value) => {
      expect(GSTIN_PATTERN.test(value)).toBe(true);
    },
  );

  it.each([
    ['one character short', '33ABCDE1234F1Z'],
    ['one character too long', '33ABCDE1234F1Z55'],
    ['letters in the state code', 'AAABCDE1234F1Z5'],
    ['digits in the PAN letters', '33AB1DE1234F1Z5'],
    ['letters in the PAN digits', '33ABCDE12X4F1Z5'],
    ['a digit where the PAN ends in a letter', '33ABCDE123451Z5'],
    ['0 as the entity number', '33ABCDE1234F0Z5'],
    ['something other than Z in the 14th place', '33ABCDE1234F1X5'],
    ['a lower-case letter', '33abcde1234f1z5'],
    ['a space inside', '33ABCDE 234F1Z5'],
  ])('does not match %s', (_label, value) => {
    expect(GSTIN_PATTERN.test(value)).toBe(false);
  });
});

describe('gstinSchema', () => {
  it('accepts a valid GSTIN, typed in any case with spaces around it, and returns it upper-case', () => {
    expect(gstinSchema.parse(GSTIN)).toBe(GSTIN);
    expect(gstinSchema.parse(`  ${GSTIN.toLowerCase()} `)).toBe(GSTIN);
  });

  it('turns a blank value into null (no GSTIN) and keeps null as null', () => {
    expect(gstinSchema.parse('')).toBeNull();
    expect(gstinSchema.parse('    ')).toBeNull();
    expect(gstinSchema.parse(null)).toBeNull();
  });

  it('leaves an absent value absent', () => {
    expect(gstinSchema.parse(undefined)).toBeUndefined();
  });

  it.each(['33ABCDE1234F1Z', '33ABCDE1234F1Z55', 'not a gstin', '33ABCDE1234F1X5'])(
    'refuses %j',
    (value) => {
      expect(gstinSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('createVendorSchema', () => {
  it('needs only a name; the rest is optional and extra fields (isActive included) are ignored', () => {
    expect(createVendorSchema.parse({ name: ' Sri Traders ', isActive: false })).toEqual({
      name: 'Sri Traders',
    });
    expect(createVendorSchema.safeParse({}).success).toBe(false);
  });

  it('takes the phone, address and GSTIN, trimmed, with the GSTIN in upper-case', () => {
    expect(
      createVendorSchema.parse({
        name: 'Sri Traders',
        phone: ' 9876543210 ',
        address: ' 12 Market Road ',
        gstin: GSTIN.toLowerCase(),
      }),
    ).toEqual({
      name: 'Sri Traders',
      phone: '9876543210',
      address: '12 Market Road',
      gstin: GSTIN,
    });
  });

  it('turns a blank phone, address or GSTIN into null', () => {
    expect(createVendorSchema.parse({ name: 'A', phone: ' ', address: '', gstin: '  ' })).toEqual({
      name: 'A',
      phone: null,
      address: null,
      gstin: null,
    });
  });

  it('refuses a GSTIN that is not 15 characters in the pattern, on the GSTIN', () => {
    const result = createVendorSchema.safeParse({ name: 'A', gstin: '33ABCDE1234F1Z' });
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe('gstin');
  });

  it('refuses a phone over 20 characters and an address over 200', () => {
    expect(createVendorSchema.safeParse({ name: 'A', phone: '9'.repeat(21) }).success).toBe(false);
    expect(createVendorSchema.safeParse({ name: 'A', phone: '9'.repeat(20) }).success).toBe(true);
    expect(createVendorSchema.safeParse({ name: 'A', address: 'a'.repeat(201) }).success).toBe(
      false,
    );
    expect(createVendorSchema.safeParse({ name: 'A', address: 'a'.repeat(200) }).success).toBe(
      true,
    );
  });
});

describe('updateVendorSchema', () => {
  it('takes any subset of the fields, including isActive', () => {
    expect(updateVendorSchema.parse({ name: ' New name ' })).toEqual({ name: 'New name' });
    expect(updateVendorSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(updateVendorSchema.parse({ gstin: GSTIN.toLowerCase() })).toEqual({ gstin: GSTIN });
  });

  it('clears the phone, address and GSTIN with null or a blank value', () => {
    expect(updateVendorSchema.parse({ phone: null, address: null, gstin: null })).toEqual({
      phone: null,
      address: null,
      gstin: null,
    });
    expect(updateVendorSchema.parse({ phone: ' ', address: '', gstin: ' ' })).toEqual({
      phone: null,
      address: null,
      gstin: null,
    });
  });

  it('needs at least one field', () => {
    expect(updateVendorSchema.safeParse({}).success).toBe(false);
    expect(updateVendorSchema.safeParse({ unknown: 1 }).success).toBe(false);
  });

  it('applies the same rules as create to each field', () => {
    expect(updateVendorSchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(updateVendorSchema.safeParse({ gstin: '33ABCDE1234F1Z' }).success).toBe(false);
    expect(updateVendorSchema.safeParse({ phone: '9'.repeat(21) }).success).toBe(false);
    expect(updateVendorSchema.safeParse({ isActive: 'no' }).success).toBe(false);
  });
});

describe('listVendorsQuerySchema', () => {
  it('is the standard paging query with no filters by default', () => {
    expect(listVendorsQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
  });

  it('takes search (trimmed; blank means none) and active', () => {
    expect(listVendorsQuerySchema.parse({ search: '  sri ', active: 'false' })).toEqual({
      limit: 20,
      offset: 0,
      search: 'sri',
      active: false,
    });
    expect(listVendorsQuerySchema.parse({ search: '   ' }).search).toBeUndefined();
    expect(listVendorsQuerySchema.parse({ active: 'true' }).active).toBe(true);
  });

  it.each([{ active: 'maybe' }, { limit: '101' }, { offset: '-1' }])('refuses %j', (query) => {
    expect(listVendorsQuerySchema.safeParse(query).success).toBe(false);
  });

  it('refuses a search longer than 100 characters', () => {
    expect(listVendorsQuerySchema.safeParse({ search: 's'.repeat(101) }).success).toBe(false);
  });
});
