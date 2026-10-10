// Client settings API contract (Admin only): the business details shown on screens and bills.
// The GSTIN column exists but is deliberately not part of this API until GST is decided (PD-01).
import { z } from 'zod';
import { optionalText } from './common.js';

export const businessNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter the business name')
  .max(120, 'Use at most 120 characters');

/** PUT replaces the whole record: an omitted address or phone is cleared. */
export const updateSettingsSchema = z.object({
  businessName: businessNameSchema,
  address: optionalText(200),
  phone: optionalText(20),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export interface ClientSettings {
  businessName: string;
  address: string | null;
  phone: string | null;
  updatedAt: string;
}
