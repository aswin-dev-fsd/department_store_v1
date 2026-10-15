// Item API contract (cashiers manage their own branch's items; overview §6.1; D-03, D-11, D-12).
// Used by the backend (validation) and the frontend (forms). Prices are integer paise.
import { z } from 'zod';
import { activeFilterSchema, optionalText, searchTextSchema, wholeNumberText } from './common.js';
import { paginationSchema } from './pagination.js';

/** A sanity cap on one price (₹1 crore, in paise): it catches a slipped decimal point. */
export const MAX_PRICE_PAISE = 1_000_000_000;
const MAX_REORDER_LEVEL = 1_000_000;
const CODE_MAX = 40;
const BARCODE_MAX = 50;

/** Shown on the selling price when it is above the MRP (overview §6.1). */
export const SELLING_ABOVE_MRP_MESSAGE = 'Selling price cannot be above the MRP';

/** Trimmed, 1–40 characters, any script. Uniqueness (per branch, exact) is the server's call. */
export const itemCodeSchema = z
  .string()
  .trim()
  .min(1, 'Enter the item code')
  .max(CODE_MAX, `Use at most ${CODE_MAX} characters`);

/** Trimmed, 1–100 characters, any script. The name carries the pack size, e.g. "Rice 10 kg" (D-03). */
export const itemNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter the item name')
  .max(100, 'Use at most 100 characters');

const paiseSchema = z
  .number()
  .int('Enter a whole number of paise')
  .min(0, 'A price cannot be negative')
  .max(MAX_PRICE_PAISE, 'This price is too large');

const categoryIdSchema = z.number().int().min(1, 'Choose a category').nullable().optional();
const reorderLevelSchema = z
  .number()
  .int('Enter a whole number')
  .min(0, 'Cannot be negative')
  .max(MAX_REORDER_LEVEL, 'This number is too large')
  .nullable()
  .optional();

type Prices = { mrpPaise?: number; sellingPricePaise?: number };

/** True unless both prices are given and the selling price is above the MRP. */
function sellingWithinMrp({ mrpPaise, sellingPricePaise }: Prices): boolean {
  return mrpPaise === undefined || sellingPricePaise === undefined || sellingPricePaise <= mrpPaise;
}

export const createItemSchema = z
  .object({
    code: itemCodeSchema,
    /** Scanned at the counter; optional, and a blank value means "no barcode". */
    barcode: optionalText(BARCODE_MAX),
    name: itemNameSchema,
    categoryId: categoryIdSchema,
    mrpPaise: paiseSchema,
    sellingPricePaise: paiseSchema,
    /** Low-stock warnings use this, in packs; empty means "no warning". */
    reorderLevel: reorderLevelSchema,
  })
  .refine(sellingWithinMrp, { path: ['sellingPricePaise'], message: SELLING_ABOVE_MRP_MESSAGE });
export type CreateItemInput = z.infer<typeof createItemSchema>;

/**
 * Any subset of the fields; `isActive: false` deactivates the item. The barcode, category and
 * reorder level are cleared with null. The price rule is checked here only when both prices are
 * sent; with one, the server compares it with the stored other price.
 */
export const updateItemSchema = z
  .object({
    code: itemCodeSchema.optional(),
    barcode: optionalText(BARCODE_MAX),
    name: itemNameSchema.optional(),
    categoryId: categoryIdSchema,
    mrpPaise: paiseSchema.optional(),
    sellingPricePaise: paiseSchema.optional(),
    reorderLevel: reorderLevelSchema,
    isActive: z.boolean().optional(),
  })
  .refine((fields) => Object.values(fields).some((value) => value !== undefined), {
    message: 'Send at least one field to change',
  })
  .refine(sellingWithinMrp, { path: ['sellingPricePaise'], message: SELLING_ABOVE_MRP_MESSAGE });
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

/** Search by name, code or barcode (any part, any case); `active` left out means both. */
export const listItemsQuerySchema = paginationSchema.extend({
  search: searchTextSchema,
  categoryId: wholeNumberText('Must be a positive whole number')
    .pipe(z.number().int().min(1, 'Must be a positive whole number'))
    .optional(),
  active: activeFilterSchema,
});
export type ListItemsQuery = z.infer<typeof listItemsQuerySchema>;

const lookupText = (max: number) =>
  z.string().trim().min(1, 'Enter a value').max(max, `Use at most ${max} characters`);

/** The counter's exact match: a scanned barcode or a typed code, one of them. */
export const lookupItemQuerySchema = z
  .object({ barcode: lookupText(BARCODE_MAX).optional(), code: lookupText(CODE_MAX).optional() })
  .refine((query) => (query.barcode === undefined) !== (query.code === undefined), {
    message: 'Give either a barcode or a code',
  });
export type LookupItemQuery = z.infer<typeof lookupItemQuerySchema>;

export interface Item {
  id: number;
  code: string;
  barcode: string | null;
  name: string;
  categoryId: number | null;
  mrpPaise: number;
  sellingPricePaise: number;
  reorderLevel: number | null;
  isActive: boolean;
  /** Packs on the shelf now (from the stock ledger). */
  stock: number;
  createdAt: string;
  updatedAt: string;
}
