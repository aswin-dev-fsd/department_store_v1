// Stock adjustment API contract (D-20; overview §6.8): a cashier corrects an item's stock by a
// whole number of packs, up or down, with a reason. "Other" needs a note. Stock never goes below
// zero: the server refuses with INSUFFICIENT_STOCK.
import { z } from 'zod';
import { optionalText } from './common.js';
import { ADJUSTMENT_REASONS, type AdjustmentReason } from './stock.js';

/** A sanity cap on one adjustment, in packs either way (the same as a purchase line). */
export const MAX_ADJUSTMENT_QUANTITY = 1_000_000;

export const createAdjustmentSchema = z
  .strictObject({
    itemId: z.number().int().min(1, 'Choose an item'),
    /** Signed, in packs: + adds stock, − removes it. */
    quantity: z
      .number({ error: 'Enter a whole number of packs, like 5 or -2' })
      .int('Enter a whole number of packs, like 5 or -2')
      .min(-MAX_ADJUSTMENT_QUANTITY, 'This quantity is too large')
      .max(MAX_ADJUSTMENT_QUANTITY, 'This quantity is too large')
      .refine((quantity) => quantity !== 0, 'Enter a change other than 0'),
    reason: z.enum(ADJUSTMENT_REASONS, { error: 'Choose a reason' }),
    /** Optional, except for the reason "other"; blank means none. */
    note: optionalText(200),
  })
  .refine((input) => input.reason !== 'other' || (input.note ?? null) !== null, {
    path: ['note'],
    message: 'Describe the reason in a note',
  });
export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;

/** A saved adjustment: the change and the stock either side of it. */
export interface StockAdjustment {
  itemId: number;
  /** Signed, in packs. */
  quantity: number;
  reason: AdjustmentReason;
  note: string | null;
  balanceBefore: number;
  balanceAfter: number;
}
