import { describe, expect, it } from 'vitest';
import {
  customerNameSchema,
  lookupCustomerQuerySchema,
  normalisePhone,
  PHONE_MESSAGE,
  phoneSchema,
} from './customers.js';

describe('normalisePhone', () => {
  it.each(['+91 98765 43210', '09876543210', '9876543210'])('turns %s into 9876543210', (input) => {
    expect(normalisePhone(input)).toBe('9876543210');
  });

  it.each([
    ['+919876543210', '9876543210'],
    ['919876543210', '9876543210'],
    ['98765-43210', '9876543210'],
    ['(98765) 43210', '9876543210'],
    [' 6000000000 ', '6000000000'],
    ['+91-70000-00000', '7000000000'],
  ])('turns %s into %s', (input, phone) => {
    expect(normalisePhone(input)).toBe(phone);
  });

  it.each([
    ['empty', ''],
    ['too short', '987654321'],
    ['too long', '98765432101'],
    ['starting with 5', '5876543210'],
    ['starting with 0 after the prefix', '+91 0876543210'],
    ['a landline with an STD code', '0422 2345678'],
    ['letters', '98765abcde'],
    ['another country code', '+1 9876543210'],
    ['a plus sign alone', '+9876543210'],
  ])('refuses a number that is %s', (_label, input) => {
    expect(normalisePhone(input)).toBeNull();
  });
});

describe('phoneSchema', () => {
  it('gives the stored 10 digits', () => {
    expect(phoneSchema.parse('+91 98765 43210')).toBe('9876543210');
  });

  it('refuses anything else with one plain message', () => {
    const result = phoneSchema.safeParse('12345');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(PHONE_MESSAGE);
  });

  it('refuses a very long text before reading it', () => {
    expect(phoneSchema.safeParse('9'.repeat(21)).success).toBe(false);
  });
});

describe('lookupCustomerQuerySchema', () => {
  it('reads the phone from the query string', () => {
    expect(lookupCustomerQuerySchema.parse({ phone: '09876543210' })).toEqual({
      phone: '9876543210',
    });
  });

  it('refuses a missing or bad phone, on the phone', () => {
    expect(lookupCustomerQuerySchema.safeParse({}).error?.issues[0]?.path).toEqual(['phone']);
    expect(lookupCustomerQuerySchema.safeParse({ phone: 'x' }).error?.issues[0]?.path).toEqual([
      'phone',
    ]);
  });
});

describe('customerNameSchema', () => {
  it('trims a name and treats a blank one as none', () => {
    expect(customerNameSchema.parse('  Kumar ')).toBe('Kumar');
    expect(customerNameSchema.parse('  ')).toBeNull();
    expect(customerNameSchema.parse(undefined)).toBeUndefined();
  });

  it('allows up to 100 characters', () => {
    expect(customerNameSchema.safeParse('n'.repeat(100)).success).toBe(true);
    expect(customerNameSchema.safeParse('n'.repeat(101)).success).toBe(false);
  });
});
