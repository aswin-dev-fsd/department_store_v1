// Login and session API contract — used by the backend (validation) and the frontend (forms).
import { z } from 'zod';
import type { Permission, Role } from '../permissions.js';

/** bcrypt ignores everything after 72 bytes, so longer passwords are refused everywhere. */
export const PASSWORD_MAX_BYTES = 72;

/** Minimum length for a newly chosen password (proposed — confirm at Checkpoint 2). */
export const PASSWORD_MIN_LENGTH = 8;

const fitsBcrypt = (value: string) => new TextEncoder().encode(value).length <= PASSWORD_MAX_BYTES;
const tooLong = `Password must be at most ${PASSWORD_MAX_BYTES} bytes`;

/** Any existing password: required, within bcrypt's limit, never trimmed. */
const passwordField = z.string().min(1, 'Enter the password').refine(fitsBcrypt, tooLong);

/** A new password: also long enough. */
const newPasswordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .refine(fitsBcrypt, tooLong);

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Enter the username').max(64),
  password: passwordField,
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: passwordField,
  newPassword: newPasswordField,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const selectBranchSchema = z.object({
  branchId: z.number().int().positive(),
});
export type SelectBranchInput = z.infer<typeof selectBranchSchema>;

export interface BranchSummary {
  id: number;
  code: string;
  name: string;
}

/** GET /auth/me — also returned by login, select-branch and change-password. */
export interface MeResponse {
  user: {
    id: number;
    username: string;
    fullName: string;
    role: Role;
    mustChangePassword: boolean;
  };
  permissions: Permission[];
  /** Branches this cashier may work in (empty for admins). */
  branches: BranchSummary[];
  activeBranchId: number | null;
  /** A cashier without a usable active branch must pick one (or ask the Admin for one). */
  needsBranchSelection: boolean;
}
