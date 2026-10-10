import { describe, expect, it } from 'vitest';
import { changedFields } from './changes.js';

const current = { name: 'Tiruppur', phone: null as string | null, isActive: true };

describe('changedFields', () => {
  it('returns the old and new value of only the fields that differ', () => {
    expect(changedFields(current, { name: 'Coimbatore', isActive: true })).toEqual({
      before: { name: 'Tiruppur' },
      after: { name: 'Coimbatore' },
    });
  });

  it('treats an absent (undefined) field as "leave as it is"', () => {
    expect(changedFields(current, { name: undefined, isActive: false })).toEqual({
      before: { isActive: true },
      after: { isActive: false },
    });
  });

  it('tells null apart from text, so a field can be set and cleared', () => {
    expect(changedFields(current, { phone: '0422-1' })).toEqual({
      before: { phone: null },
      after: { phone: '0422-1' },
    });
    const withPhone: typeof current = { ...current, phone: '0422-1' };
    expect(changedFields(withPhone, { phone: null })).toEqual({
      before: { phone: '0422-1' },
      after: { phone: null },
    });
  });

  it('returns null when nothing would change, so no audit row is written', () => {
    expect(changedFields(current, { name: 'Tiruppur', phone: null, isActive: true })).toBeNull();
    expect(changedFields(current, {})).toBeNull();
    expect(changedFields(current, { name: undefined })).toBeNull();
  });

  it('does not modify its inputs', () => {
    const snapshot = structuredClone(current);
    changedFields(current, { name: 'Other' });
    expect(current).toEqual(snapshot);
  });
});
