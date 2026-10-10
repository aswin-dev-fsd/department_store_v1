import { describe, expect, it } from 'vitest';
import {
  changePasswordSchema,
  loginSchema,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  selectBranchSchema,
} from './auth.js';

describe('loginSchema', () => {
  it('trims the username and keeps the password exactly as typed', () => {
    expect(loginSchema.parse({ username: '  ravi ', password: ' pass word ' })).toEqual({
      username: 'ravi',
      password: ' pass word ',
    });
  });

  it('requires both fields', () => {
    expect(loginSchema.safeParse({ username: '', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ username: 'ravi', password: '' }).success).toBe(false);
  });

  it(`refuses passwords over ${PASSWORD_MAX_BYTES} bytes, counted in bytes not characters`, () => {
    expect(loginSchema.safeParse({ username: 'r', password: 'a'.repeat(72) }).success).toBe(true);
    expect(loginSchema.safeParse({ username: 'r', password: 'a'.repeat(73) }).success).toBe(false);
    // 25 Tamil letters = 25 characters but 75 bytes
    expect(loginSchema.safeParse({ username: 'r', password: 'த'.repeat(25) }).success).toBe(false);
  });
});

describe('changePasswordSchema', () => {
  it(`needs a new password of at least ${PASSWORD_MIN_LENGTH} characters`, () => {
    const short = 'a'.repeat(PASSWORD_MIN_LENGTH - 1);
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: short }).success,
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: `${short}b` }).success,
    ).toBe(true);
  });
});

describe('selectBranchSchema', () => {
  it('takes a positive whole branch id', () => {
    expect(selectBranchSchema.parse({ branchId: 3 })).toEqual({ branchId: 3 });
    expect(selectBranchSchema.safeParse({ branchId: 0 }).success).toBe(false);
    expect(selectBranchSchema.safeParse({ branchId: '3' }).success).toBe(false);
  });
});
