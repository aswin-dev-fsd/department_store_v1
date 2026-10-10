// User management API contract (Admin only) and the user fields shared with the setup script
// (D-04). The role and username are fixed once an account exists in v1: to change either,
// create a new account.
import { z } from 'zod';
import { ROLES, type Role } from '../permissions.js';
import type { BranchSummary } from './auth.js';
import { paginationSchema } from './pagination.js';

/**
 * 3–32 characters: lowercase letters, digits, dot, underscore, hyphen; starting with a letter
 * or digit. ASCII only, so it types easily on any counter keyboard (proposed — confirm at
 * Checkpoint 2). Names in Tamil belong in the full name, not the username.
 */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** Trimmed and lower-cased first, because the database treats usernames as unique ignoring case. */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    USERNAME_PATTERN,
    'Use 3–32 characters: letters, digits, dots, underscores or hyphens, starting with a letter or digit',
  );

export const fullNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter the full name')
  .max(100, 'Use at most 100 characters');

/** The server makes the temporary password, so there is no password field to send. */
export const createUserSchema = z.object({
  username: usernameSchema,
  fullName: fullNameSchema,
  role: z.enum(ROLES),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

/** A new name and/or an active flag (`isActive: false` deactivates the account). */
export const updateUserSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((fields) => Object.values(fields).some((value) => value !== undefined), {
    message: 'Send at least one field to change',
  });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** The complete list of branches a cashier may work in; it replaces the current one. */
export const setUserBranchesSchema = z.object({
  branchIds: z.array(z.number().int().min(1)).max(100),
});
export type SetUserBranchesInput = z.infer<typeof setUserBranchesSchema>;

export const listUsersQuerySchema = paginationSchema.extend({
  role: z.enum(ROLES).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/** A branch as the Admin sees it on a user: inactive branches stay visible so they can be removed. */
export interface UserBranch extends BranchSummary {
  isActive: boolean;
}

export interface UserSummary {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Always empty for an Admin. */
  branches: UserBranch[];
}

/** The answer to creating a user: the temporary password is shown this once, never again. */
export interface CreatedUser {
  user: UserSummary;
  temporaryPassword: string;
}

/** The answer to a password reset: shown once. */
export interface PasswordReset {
  temporaryPassword: string;
}
