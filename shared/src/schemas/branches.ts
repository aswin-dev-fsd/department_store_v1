// Branch management API contract (Admin only). Rules: overview §5.2 `branches`; D-15 (the code
// appears in bill numbers, so it is short).
import { z } from 'zod';
import { optionalText } from './common.js';
import { paginationSchema } from './pagination.js';

export const BRANCH_CODE_PATTERN = /^[A-Z]{1,3}$/;

/** 1–3 letters; typed in any case, stored upper-case. */
export const branchCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(BRANCH_CODE_PATTERN, 'Use 1–3 letters (A–Z)');

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter the branch name')
  .max(100, 'Use at most 100 characters');
const addressSchema = z
  .string()
  .trim()
  .min(1, 'Enter the address')
  .max(200, 'Use at most 200 characters');

export const createBranchSchema = z.object({
  code: branchCodeSchema,
  name: nameSchema,
  address: addressSchema,
  phone: optionalText(20),
  /** Printed at the bottom of every bill from this branch. */
  billFooter: optionalText(300),
});
export type CreateBranchInput = z.infer<typeof createBranchSchema>;

/** Any subset of the fields; `isActive: false` deactivates the branch. */
export const updateBranchSchema = z
  .object({
    code: branchCodeSchema.optional(),
    name: nameSchema.optional(),
    address: addressSchema.optional(),
    phone: optionalText(20),
    billFooter: optionalText(300),
    isActive: z.boolean().optional(),
  })
  .refine((fields) => Object.values(fields).some((value) => value !== undefined), {
    message: 'Send at least one field to change',
  });
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;

export const listBranchesQuerySchema = paginationSchema.extend({
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type ListBranchesQuery = z.infer<typeof listBranchesQuerySchema>;

export interface Branch {
  id: number;
  code: string;
  name: string;
  address: string;
  phone: string | null;
  billFooter: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
