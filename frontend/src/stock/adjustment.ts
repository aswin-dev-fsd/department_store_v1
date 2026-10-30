import {
  ADJUSTMENT_REASONS,
  MAX_ADJUSTMENT_QUANTITY,
  type AdjustmentReason,
  type CreateAdjustmentInput,
} from '@ds/shared';
import { t } from '../i18n/t';

// The stock adjustment form's checks (D-20), pure so they are tested without React. The server
// checks everything again and has the last word on the stock.

export type Direction = 'add' | 'remove';

export interface AdjustmentForm {
  direction: Direction;
  /** Packs as typed. */
  quantity: string;
  /** Empty until one is chosen. */
  reason: AdjustmentReason | '';
  note: string;
}

export const EMPTY_ADJUSTMENT: AdjustmentForm = {
  direction: 'remove',
  quantity: '',
  reason: '',
  note: '',
};

export interface AdjustmentCheck {
  /** Per field: what is wrong, in plain words. */
  errors: Partial<Record<'quantity' | 'reason' | 'note', string>>;
  /** The signed change, when the quantity is readable. */
  change: number | null;
  /** The stock after the change, when the quantity is readable. */
  after: number | null;
  /** What the server is sent; null while anything is wrong or stock would go below zero. */
  input: CreateAdjustmentInput | null;
}

function isReason(value: string): value is AdjustmentReason {
  return (ADJUSTMENT_REASONS as readonly string[]).includes(value);
}

/** Check the form against the item's stock: the change, the stock after it, and the request. */
export function checkAdjustment(
  form: AdjustmentForm,
  itemId: number,
  stock: number,
): AdjustmentCheck {
  const errors: AdjustmentCheck['errors'] = {};
  const trimmed = form.quantity.trim();
  const packs = /^\d{1,7}$/.test(trimmed) ? Number(trimmed) : null;
  if (packs === null || packs < 1 || packs > MAX_ADJUSTMENT_QUANTITY) {
    errors.quantity = t('adjust.quantityFormat');
  }
  if (!isReason(form.reason)) errors.reason = t('adjust.reasonRequired');
  const note = form.note.trim();
  if (form.reason === 'other' && note === '') errors.note = t('adjust.noteRequired');

  const change = errors.quantity ? null : (form.direction === 'add' ? 1 : -1) * packs!;
  const after = change === null ? null : stock + change;
  if (after !== null && after < 0) errors.quantity = t('adjust.belowZero', { count: stock });

  const ready = Object.keys(errors).length === 0 && change !== null && isReason(form.reason);
  return {
    errors,
    change,
    after,
    input: ready
      ? {
          itemId,
          quantity: change,
          reason: form.reason as AdjustmentReason,
          ...(note !== '' && { note }),
        }
      : null,
  };
}
