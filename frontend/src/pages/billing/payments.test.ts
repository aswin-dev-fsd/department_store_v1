import { describe, expect, it } from 'vitest';
import {
  EMPTY_PAYMENTS,
  paiseToRupeesText,
  restInCash,
  summarizePayments,
  type PaymentDraft,
} from './payments';

// The overview §6.4 worked example: a bill of ₹1,036
const TOTAL = 103600;

const pay = (change: Partial<PaymentDraft>): PaymentDraft => ({ ...EMPTY_PAYMENTS, ...change });

describe('summarizePayments', () => {
  it('is ready for one mode paying the exact total, and sends only that mode', () => {
    const summary = summarizePayments(pay({ upi: '1036' }), TOTAL);
    expect(summary).toMatchObject({ paidPaise: TOTAL, remainingPaise: 0, ready: true });
    expect(summary.input).toEqual([{ mode: 'upi', amountPaise: TOTAL }]);
  });

  it('is ready for a three-way split that adds up exactly', () => {
    const summary = summarizePayments(pay({ cash: '500', upi: '436', card: '100' }), TOTAL);
    expect(summary.ready).toBe(true);
    expect(summary.input).toEqual([
      { mode: 'cash', amountPaise: 50000 },
      { mode: 'upi', amountPaise: 43600 },
      { mode: 'card', amountPaise: 10000 },
    ]);
  });

  it('shows what is left to pay, and is not ready, while short', () => {
    expect(summarizePayments(pay({ cash: '500' }), TOTAL)).toMatchObject({
      remainingPaise: 53600,
      ready: false,
    });
  });

  it('is not ready when the payments are more than the total', () => {
    expect(summarizePayments(pay({ cash: '1100' }), TOTAL)).toMatchObject({
      remainingPaise: -6400,
      ready: false,
    });
  });

  it('flags an amount that is not rupees, and is not ready', () => {
    const summary = summarizePayments(pay({ cash: '1036', card: 'abc' }), TOTAL);
    expect(summary.problems).toEqual({ card: 'Write the amount in rupees, like 250.50.' });
    expect(summary.ready).toBe(false);
  });

  it('works out the change from the cash handed over, which is never sent', () => {
    const summary = summarizePayments(pay({ cash: '1036', tendered: '1100' }), TOTAL);
    expect(summary).toMatchObject({ changePaise: 6400, tenderedProblem: null, ready: true });
    expect(summary.input).toEqual([{ mode: 'cash', amountPaise: TOTAL }]);
  });

  it('counts the change against the cash part only in a split', () => {
    const summary = summarizePayments(pay({ cash: '536', upi: '500', tendered: '600' }), TOTAL);
    expect(summary).toMatchObject({ changePaise: 6400, ready: true });
  });

  it('refuses cash handed over that is less than the cash part', () => {
    const summary = summarizePayments(pay({ cash: '1036', tendered: '1000' }), TOTAL);
    expect(summary).toMatchObject({
      changePaise: null,
      tenderedProblem: 'The cash handed over is less than the cash amount.',
      ready: false,
    });
  });

  it('is never ready for a bill of 0, which the server cannot record a payment for', () => {
    expect(summarizePayments(EMPTY_PAYMENTS, 0).ready).toBe(false);
  });
});

describe('restInCash', () => {
  it('puts what UPI and card leave into cash', () => {
    expect(restInCash(pay({ upi: '436', card: '100', cash: '1' }), TOTAL)).toMatchObject({
      cash: '500.00',
    });
  });

  it('fills the whole total when nothing else is entered', () => {
    expect(restInCash(EMPTY_PAYMENTS, 103625).cash).toBe('1036.25');
  });

  it('changes nothing when UPI or card is unreadable, or already covers the total', () => {
    const unreadable = pay({ upi: 'x' });
    expect(restInCash(unreadable, TOTAL)).toBe(unreadable);
    const covered = pay({ card: '1036' });
    expect(restInCash(covered, TOTAL)).toBe(covered);
  });
});

describe('paiseToRupeesText', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [103600, '1036.00'],
    [123456789, '1234567.89'],
  ])('%i paise → %s', (paise, text) => {
    expect(paiseToRupeesText(paise)).toBe(text);
  });
});
