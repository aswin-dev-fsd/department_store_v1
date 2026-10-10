import { describe, expect, it } from 'vitest';
import { formatPaise, rupeesToPaise } from './money.js';

describe('rupeesToPaise', () => {
  it.each([
    ['145.50', 14550],
    ['145.5', 14550],
    ['145', 14500],
    ['0', 0],
    ['0.05', 5],
    ['1036.00', 103600],
    [' 38.25 ', 3825],
  ])('converts %j to %i paise', (input, expected) => {
    expect(rupeesToPaise(input)).toBe(expected);
  });

  it.each([['1.234'], ['-5'], ['abc'], [''], ['145.'], ['.50'], ['1,036.00'], ['1e3']])(
    'rejects %j',
    (input) => {
      expect(() => rupeesToPaise(input)).toThrow(/Invalid rupee amount/);
    },
  );

  it('rejects amounts too large to hold exactly', () => {
    expect(() => rupeesToPaise('999999999999999999')).toThrow(/too large/);
  });
});

describe('formatPaise', () => {
  it.each([
    [14550, '₹145.50'],
    [103600, '₹1,036.00'],
    [10000000, '₹1,00,000.00'],
    [5, '₹0.05'],
    [0, '₹0.00'],
    [-40, '-₹0.40'],
  ])('formats %i paise as %s', (paise, expected) => {
    expect(formatPaise(paise)).toBe(expected);
  });

  it('rejects non-integer paise', () => {
    expect(() => formatPaise(14550.5)).toThrow(/whole number of paise/);
  });
});
