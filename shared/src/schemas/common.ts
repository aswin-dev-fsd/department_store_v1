// Building blocks shared by the API schemas.
import { z } from 'zod';

/**
 * A whole number sent as text, e.g. in a URL or query string: digits only (at most 15), so
 * `1e3`, `0x10`, ` 5` and `1.5` are refused instead of being quietly converted.
 */
export const wholeNumberText = (message = 'Must be a whole number') =>
  z
    .string()
    .regex(/^\d{1,15}$/, message)
    .transform(Number);

/** `:id` in a URL: a positive whole number. */
export const idParamSchema = z.object({
  id: wholeNumberText('Must be a positive whole number').pipe(
    z.number().int().min(1, 'Must be a positive whole number'),
  ),
});
export type IdParams = z.infer<typeof idParamSchema>;

/**
 * Optional free text: trimmed, at most `max` characters. An empty or blank value becomes null,
 * which is how a field is cleared; an absent field stays absent.
 */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

/** A search box in a query string: trimmed, at most 100 characters; blank means no search. */
export const searchTextSchema = z
  .string()
  .trim()
  .max(100, 'Use at most 100 characters')
  .transform((value) => (value === '' ? undefined : value))
  .optional();

/** A `true` / `false` filter in a query string; left out means "both". */
export const activeFilterSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();
