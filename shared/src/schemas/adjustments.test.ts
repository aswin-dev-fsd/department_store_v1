import { describe, expect, it } from 'vitest';
import { createAdjustmentSchema, MAX_ADJUSTMENT_QUANTITY } from './adjustments.js';

const valid = { itemId: 1, quantity: -2, reason: 'damage' };

function issues(input: object) {
  const result = createAdjustmentSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
}

describe('createAdjustmentSchema', () => {
  it('accepts a decrease or an increase with a reason; the note is optional and blank means none', () => {
    expect(createAdjustmentSchema.parse(valid)).toEqual(valid);
    expect(createAdjustmentSchema.parse({ ...valid, quantity: 5, note: '  ' })).toEqual({
      ...valid,
      quantity: 5,
      note: null,
    });
  });

  it.each([0, 1.5, MAX_ADJUSTMENT_QUANTITY + 1, -MAX_ADJUSTMENT_QUANTITY - 1])(
    'refuses a quantity of %s',
    (quantity) => {
      expect(issues({ ...valid, quantity })[0]?.[0]).toBe('quantity');
    },
  );

  it('refuses a missing quantity or a quantity sent as text', () => {
    expect(issues({ itemId: 1, reason: 'damage' })[0]?.[0]).toBe('quantity');
    expect(issues({ ...valid, quantity: '-2' })[0]?.[0]).toBe('quantity');
  });

  it('accepts each of the five reasons and refuses anything else', () => {
    for (const reason of ['damage', 'expiry', 'theft', 'count_correction']) {
      expect(createAdjustmentSchema.safeParse({ ...valid, reason }).success).toBe(true);
    }
    expect(issues({ ...valid, reason: 'gift' })).toEqual([['reason', 'Choose a reason']]);
    expect(issues({ itemId: 1, quantity: 1 })).toEqual([['reason', 'Choose a reason']]);
  });

  it('needs a note for the reason "other"', () => {
    expect(issues({ ...valid, reason: 'other' })).toEqual([
      ['note', 'Describe the reason in a note'],
    ]);
    expect(issues({ ...valid, reason: 'other', note: '   ' })).toEqual([
      ['note', 'Describe the reason in a note'],
    ]);
    expect(
      createAdjustmentSchema.parse({ ...valid, reason: 'other', note: ' Sample to vendor ' }),
    ).toMatchObject({ note: 'Sample to vendor' });
  });

  it('refuses a note over 200 characters and any field it does not know', () => {
    expect(issues({ ...valid, note: 'x'.repeat(201) })[0]?.[0]).toBe('note');
    expect(createAdjustmentSchema.safeParse({ ...valid, balanceAfter: 9 }).success).toBe(false);
  });
});
