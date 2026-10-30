import { PAYMENT_MODES, type BillPaymentInput, type PaymentMode } from '@ds/shared';
import { parseRupees } from '../../catalog/forms';
import { t } from '../../i18n/t';

// The payment panel's arithmetic (overview §6.5), pure so it is tested without React. The
// payments must add up exactly to the bill total; cash handed over beyond the cash part only
// works out the change, and is never sent.

/** What the cashier typed, in rupees; blank means nothing by that mode. */
export interface PaymentDraft {
  cash: string;
  upi: string;
  card: string;
  /** The cash the customer handed over; blank when it is the exact cash amount. */
  tendered: string;
}

export const EMPTY_PAYMENTS: PaymentDraft = { cash: '', upi: '', card: '', tendered: '' };

export interface PaymentSummary {
  /** Each mode's amount in paise; null while its text is not an amount. */
  amounts: Record<PaymentMode, number | null>;
  /** What is wrong with a mode's amount, in plain words. */
  problems: Partial<Record<PaymentMode, string>>;
  paidPaise: number;
  /** The bill total less what is paid: above 0 is still to pay, below 0 is too much. */
  remainingPaise: number;
  /** Cash handed over less the cash part; null when no cash handed over is entered. */
  changePaise: number | null;
  tenderedProblem: string | null;
  /** Every amount is readable and they add up exactly to a total above 0. */
  ready: boolean;
  /** What the server is sent: one row for each mode with an amount above 0. */
  input: BillPaymentInput[];
}

/** Paise as rupee text a person can edit, e.g. 103600 → "1036.00". */
export function paiseToRupeesText(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

/** Rupees as typed, blank as 0; null for anything that is not an amount. */
function amountOf(text: string): number | null {
  return text.trim() === '' ? 0 : parseRupees(text);
}

/** The payments against the bill total: what is left, the change, and whether Save may run. */
export function summarizePayments(draft: PaymentDraft, totalPaise: number): PaymentSummary {
  const amounts = {} as Record<PaymentMode, number | null>;
  const problems: Partial<Record<PaymentMode, string>> = {};
  let paidPaise = 0;
  for (const mode of PAYMENT_MODES) {
    const amount = amountOf(draft[mode]);
    amounts[mode] = amount;
    if (amount === null) problems[mode] = t('billing.pay.amountFormat');
    else paidPaise += amount;
  }

  let changePaise: number | null = null;
  let tenderedProblem: string | null = null;
  if (draft.tendered.trim() !== '') {
    const tendered = parseRupees(draft.tendered);
    const cash = amounts.cash;
    if (tendered === null) tenderedProblem = t('billing.pay.amountFormat');
    else if (cash !== null && tendered < cash) tenderedProblem = t('billing.pay.tenderedShort');
    else if (cash !== null) changePaise = tendered - cash;
  }

  const input = PAYMENT_MODES.flatMap((mode) => {
    const amount = amounts[mode];
    return amount !== null && amount > 0 ? [{ mode, amountPaise: amount }] : [];
  });
  return {
    amounts,
    problems,
    paidPaise,
    remainingPaise: totalPaise - paidPaise,
    changePaise,
    tenderedProblem,
    ready:
      totalPaise > 0 &&
      Object.keys(problems).length === 0 &&
      tenderedProblem === null &&
      paidPaise === totalPaise,
    input,
  };
}

/**
 * The "rest in cash" quick fill: cash becomes whatever UPI and card leave of the total. Unchanged
 * when UPI or card is not an amount, or already covers the total.
 */
export function restInCash(draft: PaymentDraft, totalPaise: number): PaymentDraft {
  const upi = amountOf(draft.upi);
  const card = amountOf(draft.card);
  if (upi === null || card === null) return draft;
  const rest = totalPaise - upi - card;
  if (rest <= 0) return draft;
  return { ...draft, cash: paiseToRupeesText(rest) };
}
