import { describe, expect, it } from 'vitest';
import { checkAdjustment, EMPTY_ADJUSTMENT, type AdjustmentForm } from './adjustment';

const form = (change: Partial<AdjustmentForm>): AdjustmentForm => ({
  ...EMPTY_ADJUSTMENT,
  ...change,
});

describe('checkAdjustment', () => {
  it('takes stock down: 10 → 8 for −2 damage', () => {
    expect(checkAdjustment(form({ quantity: '2', reason: 'damage' }), 7, 10)).toEqual({
      errors: {},
      change: -2,
      after: 8,
      input: { itemId: 7, quantity: -2, reason: 'damage' },
    });
  });

  it('adds stock for a count correction, with the note trimmed', () => {
    const check = checkAdjustment(
      form({ direction: 'add', quantity: ' 3 ', reason: 'count_correction', note: ' Found ' }),
      7,
      10,
    );
    expect(check).toMatchObject({ change: 3, after: 13 });
    expect(check.input).toEqual({
      itemId: 7,
      quantity: 3,
      reason: 'count_correction',
      note: 'Found',
    });
  });

  it.each(['', '0', '1.5', '-2', 'two', '10000000'])('refuses the quantity "%s"', (quantity) => {
    const check = checkAdjustment(form({ quantity, reason: 'damage' }), 7, 10);
    expect(check.errors.quantity).toBe('Enter a whole number of packs, like 2.');
    expect(check.input).toBeNull();
  });

  it('needs a reason', () => {
    const check = checkAdjustment(form({ quantity: '1' }), 7, 10);
    expect(check.errors).toEqual({ reason: 'Choose a reason.' });
    expect(check.input).toBeNull();
  });

  it('needs a note for "other", and not for the other reasons', () => {
    expect(
      checkAdjustment(form({ quantity: '1', reason: 'other', note: '  ' }), 7, 10).errors,
    ).toEqual({
      note: 'Write what happened: a note is needed for "Other".',
    });
    expect(checkAdjustment(form({ quantity: '1', reason: 'theft' }), 7, 10).errors).toEqual({});
  });

  it('refuses to go below zero, but allows exactly zero', () => {
    const below = checkAdjustment(form({ quantity: '4', reason: 'expiry' }), 7, 3);
    expect(below).toMatchObject({ change: -4, after: -1, input: null });
    expect(below.errors.quantity).toBe('Only 3 in stock: you cannot take away more than that.');
    expect(checkAdjustment(form({ quantity: '3', reason: 'expiry' }), 7, 3)).toMatchObject({
      after: 0,
      errors: {},
    });
  });
});
