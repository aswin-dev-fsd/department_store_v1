// CSV import contract (D-24; overview §7.1). The browser sends the file as text; the server checks
// every row against importRowSchema and answers with an ImportResult, or with every problem found.
import { z } from 'zod';
import { rupeesToPaise } from '../money.js';
import { itemCodeSchema, itemNameSchema, MAX_PRICE_PAISE } from './items.js';

/**
 * The columns the file must have, in the order of the template. In the file they may come in any
 * order and in any letter case; other columns are ignored.
 */
export const IMPORT_COLUMNS = [
  'code',
  'barcode',
  'name',
  'category',
  'mrp',
  'selling_price',
  'reorder_level',
  'opening_stock',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/** A sanity cap on a reorder level or an opening stock, in packs. */
const MAX_PACKS = 1_000_000;

const PRICE_MESSAGE =
  'Write the price in rupees like 145.50: digits and a dot, no commas or ₹ sign';

/** rupeesToPaise, but NaN instead of an exception for text that is not an amount. */
function toPaise(text: string): number {
  try {
    return rupeesToPaise(text);
  } catch {
    return Number.NaN;
  }
}

/** A price written in rupees, read as whole paise. */
const priceCell = z
  .string()
  .trim()
  .min(1, 'Enter the price')
  .refine((text) => !Number.isNaN(toPaise(text)), PRICE_MESSAGE)
  .transform(toPaise)
  .pipe(z.number().max(MAX_PRICE_PAISE, 'This price is too large'));

/** Optional text: trimmed, at most `max` characters; blank means none. */
const textCell = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .transform((text) => (text === '' ? null : text));

/** A whole number of packs, 0 or more; blank means none. */
const packsCell = z
  .string()
  .trim()
  .refine((text) => text === '' || /^-?\d{1,9}$/.test(text), 'Enter a whole number, like 12')
  .transform((text) => (text === '' ? null : Number(text)))
  .pipe(
    z
      .number()
      .int()
      .min(0, 'Cannot be negative')
      .max(MAX_PACKS, 'This number is too large')
      .nullable(),
  );

/**
 * One row of the file: every cell arrives as text. The output has the prices in paise, blank
 * optional cells as null, and a blank opening stock as 0. That the selling price is not above the
 * MRP is checked by the server, after the row has passed this schema.
 */
export const importRowSchema = z.object({
  code: itemCodeSchema,
  barcode: textCell(50),
  name: itemNameSchema,
  category: textCell(100),
  mrp: priceCell,
  selling_price: priceCell,
  reorder_level: packsCell,
  opening_stock: packsCell.transform((packs) => packs ?? 0),
});
export type ImportRow = z.infer<typeof importRowSchema>;

/** One problem found in the file. `row` counts the header as row 1, so the first item is row 2. */
export interface ImportError {
  row: number;
  /** The column at fault; null when the whole row or file is. */
  column: ImportColumn | null;
  message: string;
}

/** What a successful import created. */
export interface ImportResult {
  categoriesCreated: number;
  itemsCreated: number;
  /** Items that got an `opening` ledger row (an opening stock above 0). */
  openingMovements: number;
}
