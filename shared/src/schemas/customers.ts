// Customer API contract (D-08, D-18; overview §6.9). A customer is optional on a bill and is
// known by their phone number, client-wide: the same phone is the same person at every branch.
import { z } from 'zod';
import { optionalText } from './common.js';

/** Shown when a phone number is not a 10-digit Indian mobile number. */
export const PHONE_MESSAGE = 'Enter a 10-digit mobile number, like 98765 43210';

/**
 * A phone number as typed, as the 10 digits stored: spaces, dashes, dots and brackets are
 * dropped, and a leading +91, 91 or 0 is removed. '+91 98765 43210', '09876543210' and
 * '9876543210' all become '9876543210'. Null unless the result is an Indian mobile number:
 * 10 digits starting with 6, 7, 8 or 9.
 */
export function normalisePhone(input: string): string | null {
  const digits = input.trim().replace(/[\s\-.()]/g, '');
  const local = /^\+91\d{10}$/.test(digits)
    ? digits.slice(3)
    : /^91\d{10}$/.test(digits)
      ? digits.slice(2)
      : /^0\d{10}$/.test(digits)
        ? digits.slice(1)
        : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}

/** A phone number in any common format, as its 10 stored digits; anything else is refused. */
export const phoneSchema = z
  .string({ error: PHONE_MESSAGE })
  .max(20, PHONE_MESSAGE)
  .transform((value, context) => {
    const phone = normalisePhone(value);
    if (phone === null) {
      context.addIssue({ code: 'custom', message: PHONE_MESSAGE });
      return z.NEVER;
    }
    return phone;
  });

/** A customer's optional name: trimmed, at most 100 characters; blank means none. */
export const customerNameSchema = optionalText(100);

export const lookupCustomerQuerySchema = z.object({ phone: phoneSchema });
export type LookupCustomerQuery = z.infer<typeof lookupCustomerQuerySchema>;

export interface Customer {
  id: number;
  /** 10 digits. */
  phone: string;
  name: string | null;
}
