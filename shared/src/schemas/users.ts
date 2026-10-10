// User fields shared by the setup script, the Admin screens and their API (D-04).
import { z } from 'zod';

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
