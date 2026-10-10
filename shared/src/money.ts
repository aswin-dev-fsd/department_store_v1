// All money in this system is integer paise (₹1 = 100 paise). See AGENTS.md → Money.

const RUPEE_AMOUNT = /^(\d+)(?:\.(\d{1,2}))?$/;
const rupeeGrouping = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/**
 * Convert a rupee amount typed by a person (e.g. "145.50") into integer paise.
 * Parses the digits directly, so no floating-point rounding can creep in.
 * Throws on negatives, more than two decimals, separators, or non-numeric input.
 */
export function rupeesToPaise(input: string): number {
  const match = RUPEE_AMOUNT.exec(input.trim());
  if (!match) {
    throw new Error(`Invalid rupee amount: "${input}"`);
  }
  const rupees = Number(match[1]);
  const paise = Number((match[2] ?? '').padEnd(2, '0'));
  const total = rupees * 100 + paise;
  if (!Number.isSafeInteger(total)) {
    throw new Error(`Rupee amount too large: "${input}"`);
  }
  return total;
}

/**
 * Format integer paise for display with Indian digit grouping,
 * e.g. 103600 → "₹1,036.00", 10000000 → "₹1,00,000.00", -40 → "-₹0.40".
 */
export function formatPaise(paise: number): string {
  if (!Number.isSafeInteger(paise)) {
    throw new Error(`Expected a whole number of paise, got ${paise}`);
  }
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const fractionPaise = abs % 100;
  // Subtracting first makes the division exact for every safe integer
  const rupees = rupeeGrouping.format((abs - fractionPaise) / 100);
  const fraction = String(fractionPaise).padStart(2, '0');
  return `${sign}₹${rupees}.${fraction}`;
}
