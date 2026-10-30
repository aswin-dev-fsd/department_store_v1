// Bill totals and bill numbers (overview §6.3, §6.4; D-15, D-17). The frontend uses these for the
// live preview; the backend uses the same functions for the totals it stores, so the two always
// agree. Integer paise only: no floating point touches money.

/** What a bill line needs for its amounts: the price comes from the item, not the browser. */
export interface BillLineAmounts {
  unitPricePaise: number;
  /** Whole packs, at least 1 (D-03). */
  quantity: number;
  /** An amount off the whole line (D-17); 0 for none. */
  discountPaise: number;
}

export interface ComputedLine extends BillLineAmounts {
  /** quantity × unit price, before the discount. */
  amountPaise: number;
  /** amount − discount. */
  lineTotalPaise: number;
}

export interface ComputedBill {
  lines: ComputedLine[];
  /** Σ line amounts, before discounts. */
  subtotalPaise: number;
  /** Σ line discounts. */
  discountPaise: number;
  /** Signed: what rounding subtotal − discount to the nearest rupee added (+) or took away (−). */
  roundOffPaise: number;
  /** The amount to pay: a whole number of rupees. */
  totalPaise: number;
}

/** The largest bill number a 6-digit running number allows. */
export const MAX_BILL_SEQ = 999_999;
/** A GST invoice number is at most 16 characters (D-15). */
export const MAX_BILL_NO_LENGTH = 16;

function requireWhole(value: number, what: string, min: number): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RangeError(`${what} must be a whole number of at least ${min}, got ${value}`);
  }
}

function requireSafe(value: number, what: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} is too large to add up exactly`);
  }
  return value;
}

/** One line's amount and total. Throws RangeError for a bad quantity, price or discount. */
export function computeLine(line: BillLineAmounts): ComputedLine {
  requireWhole(line.quantity, 'Quantity', 1);
  requireWhole(line.unitPricePaise, 'Unit price', 0);
  requireWhole(line.discountPaise, 'Discount', 0);
  const amountPaise = requireSafe(line.quantity * line.unitPricePaise, 'The line amount');
  if (line.discountPaise > amountPaise) {
    throw new RangeError(
      `Discount ${line.discountPaise} is more than the line amount ${amountPaise}`,
    );
  }
  return { ...line, amountPaise, lineTotalPaise: amountPaise - line.discountPaise };
}

/**
 * Round a non-negative amount to the nearest rupee; exactly 50 paise rounds up (overview §6.4,
 * proposed): 10050 → 10100, 10049 → 10000.
 */
export function roundToRupee(paise: number): number {
  requireWhole(paise, 'The amount', 0);
  const remainder = paise % 100;
  return remainder >= 50 ? paise - remainder + 100 : paise - remainder;
}

/**
 * Every amount of a bill from its lines, in order: subtotal, discount, round-off and total. Throws
 * RangeError for a bad line (see computeLine). No whole-bill discount in v1 (D-17).
 */
export function computeBill(lines: readonly BillLineAmounts[]): ComputedBill {
  const computed = lines.map(computeLine);
  let subtotalPaise = 0;
  let discountPaise = 0;
  for (const line of computed) {
    subtotalPaise = requireSafe(subtotalPaise + line.amountPaise, 'The subtotal');
    discountPaise += line.discountPaise;
  }
  const netPaise = subtotalPaise - discountPaise;
  const totalPaise = roundToRupee(netPaise);
  return {
    lines: computed,
    subtotalPaise,
    discountPaise,
    roundOffPaise: totalPaise - netPaise,
    totalPaise,
  };
}

/**
 * The printed bill number, e.g. formatBillNo('TPR', '26-27', 123) → 'TPR/26-27/000123' (D-15).
 * Throws RangeError for a running number outside 1–999999, or a result over 16 characters.
 */
export function formatBillNo(branchCode: string, fy: string, seq: number): string {
  requireWhole(seq, 'The bill sequence', 1);
  if (seq > MAX_BILL_SEQ) {
    throw new RangeError(`The bill sequence ${seq} is above ${MAX_BILL_SEQ}`);
  }
  const billNo = `${branchCode}/${fy}/${String(seq).padStart(6, '0')}`;
  if (billNo.length > MAX_BILL_NO_LENGTH) {
    throw new RangeError(`Bill number ${billNo} is longer than ${MAX_BILL_NO_LENGTH} characters`);
  }
  return billNo;
}
