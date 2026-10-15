// Vendor API contract (cashiers manage their own branch's vendors; D-08). Used by the backend
// (validation) and the frontend (forms).
import { z } from 'zod';
import { optionalText } from './common.js';
import { paginationSchema } from './pagination.js';

/** 15 characters: state code, the PAN, an entity number, "Z", a check character. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Trimmed, 1–100 characters, any script. */
export const vendorNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter the vendor name')
  .max(100, 'Use at most 100 characters');

/**
 * Optional GSTIN: typed in any case and stored upper-case; blank or null means "none". The check
 * character is not verified, only the 15-character pattern.
 */
export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .transform((value) => (value === '' ? null : value))
  .refine((value) => value === null || GSTIN_PATTERN.test(value), {
    message: 'Enter the 15-character GSTIN, like 33ABCDE1234F1Z5',
  })
  .nullable()
  .optional();

export const createVendorSchema = z.object({
  name: vendorNameSchema,
  phone: optionalText(20),
  address: optionalText(200),
  gstin: gstinSchema,
});
export type CreateVendorInput = z.infer<typeof createVendorSchema>;

/** Any subset of the fields; `isActive: false` deactivates the vendor. Null clears an optional field. */
export const updateVendorSchema = z
  .object({
    name: vendorNameSchema.optional(),
    phone: optionalText(20),
    address: optionalText(200),
    gstin: gstinSchema,
    isActive: z.boolean().optional(),
  })
  .refine((fields) => Object.values(fields).some((value) => value !== undefined), {
    message: 'Send at least one field to change',
  });
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;

/** Search by name (any part, any case); `active` left out means both. */
export const listVendorsQuerySchema = paginationSchema.extend({
  search: z
    .string()
    .trim()
    .max(100, 'Use at most 100 characters')
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type ListVendorsQuery = z.infer<typeof listVendorsQuerySchema>;

export interface Vendor {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  gstin: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
