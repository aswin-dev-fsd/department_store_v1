import { loginSchema, PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } from '@ds/shared';
import { describe, expect, it } from 'vitest';
import {
  generateTemporaryPassword,
  TEMPORARY_PASSWORD_ALPHABET,
  TEMPORARY_PASSWORD_LENGTH,
} from './temporary-password.js';

describe('generateTemporaryPassword', () => {
  it('makes a 16-character password from the safe alphabet', () => {
    const password = generateTemporaryPassword();
    expect(password).toHaveLength(TEMPORARY_PASSWORD_LENGTH);
    expect(TEMPORARY_PASSWORD_LENGTH).toBe(16);
    for (const char of password) {
      expect(TEMPORARY_PASSWORD_ALPHABET).toContain(char);
    }
  });

  it('never uses characters that are easy to confuse: I, l, 1, O, o, 0', () => {
    expect(TEMPORARY_PASSWORD_ALPHABET).not.toMatch(/[Il1Oo0]/);
    // Plain letters and digits only, so it copies and pastes cleanly everywhere
    expect(TEMPORARY_PASSWORD_ALPHABET).toMatch(/^[A-Za-z0-9]+$/);
    expect(new Set(TEMPORARY_PASSWORD_ALPHABET).size).toBe(TEMPORARY_PASSWORD_ALPHABET.length);
  });

  it('gives a different password every time', () => {
    const passwords = new Set(Array.from({ length: 500 }, () => generateTemporaryPassword()));
    expect(passwords.size).toBe(500);
  });

  it('satisfies the login and password rules', () => {
    const password = generateTemporaryPassword();
    expect(password.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
    expect(Buffer.byteLength(password)).toBeLessThanOrEqual(PASSWORD_MAX_BYTES);
    expect(loginSchema.safeParse({ username: 'admin', password }).success).toBe(true);
  });
});
