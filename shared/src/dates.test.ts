import { describe, expect, it } from 'vitest';
import { businessDate, financialYear } from './dates.js';

describe('businessDate', () => {
  it('keeps a bill at 11:30 PM IST on that IST date', () => {
    expect(businessDate(new Date('2026-10-12T18:00:00Z'))).toBe('2026-10-12');
  });

  it('moves to the next date at midnight IST, which is 18:30 UTC', () => {
    expect(businessDate(new Date('2026-10-12T18:29:59.999Z'))).toBe('2026-10-12');
    expect(businessDate(new Date('2026-10-12T18:30:00Z'))).toBe('2026-10-13');
  });

  it('is already the IST date early in the UTC day', () => {
    expect(businessDate(new Date('2026-10-12T00:00:00Z'))).toBe('2026-10-12');
  });

  it('crosses months and years at IST midnight', () => {
    expect(businessDate(new Date('2026-12-31T18:30:00Z'))).toBe('2027-01-01');
    expect(businessDate(new Date('2028-02-28T18:30:00Z'))).toBe('2028-02-29');
  });

  it('refuses an invalid date', () => {
    expect(() => businessDate(new Date('not a date'))).toThrow(RangeError);
  });
});

describe('financialYear', () => {
  it('ends at 23:59:59 IST on 31 March', () => {
    expect(financialYear(new Date('2027-03-31T18:29:59Z'))).toBe('26-27');
  });

  it('starts at 00:00 IST on 1 April', () => {
    expect(financialYear(new Date('2027-03-31T18:30:00Z'))).toBe('27-28');
  });

  it.each([
    ['2026-04-01T00:00:00+05:30', '26-27'],
    ['2026-10-30T12:00:00Z', '26-27'],
    ['2027-01-15T12:00:00Z', '26-27'],
    ['2026-03-31T23:59:59+05:30', '25-26'],
    ['2099-06-01T00:00:00Z', '99-00'],
    ['2100-01-01T00:00:00Z', '99-00'],
    ['2009-05-01T00:00:00Z', '09-10'],
  ])('puts %s in %s', (iso, fy) => {
    expect(financialYear(new Date(iso))).toBe(fy);
  });

  it('refuses an invalid date', () => {
    expect(() => financialYear(new Date(Number.NaN))).toThrow(RangeError);
  });
});
