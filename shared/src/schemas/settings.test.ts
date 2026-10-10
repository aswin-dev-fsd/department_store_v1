import { describe, expect, it } from 'vitest';
import { businessNameSchema, updateSettingsSchema } from './settings.js';

describe('businessNameSchema', () => {
  it('trims, requires text, and allows at most 120 characters', () => {
    expect(businessNameSchema.parse('  Demo Stores ')).toBe('Demo Stores');
    expect(businessNameSchema.safeParse('   ').success).toBe(false);
    expect(businessNameSchema.safeParse('a'.repeat(121)).success).toBe(false);
    expect(businessNameSchema.safeParse('கோவை ஸ்டோர்ஸ்').success).toBe(true);
  });
});

describe('updateSettingsSchema', () => {
  it('needs a business name; address and phone are optional and blank becomes null', () => {
    expect(updateSettingsSchema.parse({ businessName: 'Demo' })).toEqual({ businessName: 'Demo' });
    expect(
      updateSettingsSchema.parse({ businessName: 'Demo', address: ' ', phone: '0422-123456' }),
    ).toEqual({ businessName: 'Demo', address: null, phone: '0422-123456' });
    expect(updateSettingsSchema.safeParse({}).success).toBe(false);
  });

  it('does not accept a GSTIN: it stays out of the API until GST is decided (PD-01)', () => {
    const parsed = updateSettingsSchema.parse({ businessName: 'Demo', gstin: '33AAAAA0000A1Z5' });
    expect(parsed).toEqual({ businessName: 'Demo' });
    expect('gstin' in parsed).toBe(false);
  });
});
