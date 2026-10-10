import { randomInt } from 'node:crypto';

/**
 * Letters and digits only, without look-alikes (I, l, 1, O, o, 0), so a password read off a
 * screen or a note isn't mistyped. 56 characters × 16 places ≈ 93 bits of randomness.
 */
export const TEMPORARY_PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export const TEMPORARY_PASSWORD_LENGTH = 16;

/**
 * A random one-time password for a new or reset account. Shown once to whoever sets the account
 * up; the user must replace it at first login. Uses crypto.randomInt, so no character is likelier
 * than another.
 */
export function generateTemporaryPassword(): string {
  let password = '';
  for (let place = 0; place < TEMPORARY_PASSWORD_LENGTH; place++) {
    password += TEMPORARY_PASSWORD_ALPHABET[randomInt(TEMPORARY_PASSWORD_ALPHABET.length)];
  }
  return password;
}
