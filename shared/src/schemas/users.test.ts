import { describe, expect, it } from 'vitest';
import { fullNameSchema, usernameSchema } from './users.js';

describe('usernameSchema', () => {
  it('trims and lower-cases, because usernames are unique ignoring case', () => {
    expect(usernameSchema.parse('  Ravi.Kumar ')).toBe('ravi.kumar');
  });

  it.each(['abc', 'ravi.kumar', 'store-1', 'cashier_2', 'a'.repeat(32), '9lives'])(
    'accepts %j',
    (username) => {
      expect(usernameSchema.safeParse(username).success).toBe(true);
    },
  );

  it.each([
    ['too short', 'ab'],
    ['too long (33)', 'a'.repeat(33)],
    ['starting with a dot', '.ravi'],
    ['starting with a hyphen', '-ravi'],
    ['containing a space', 'ravi kumar'],
    ['containing an @', 'ravi@store'],
    ['non-ASCII letters', 'ரவி'],
    ['empty', ''],
    ['only spaces', '   '],
  ])('rejects a username that is %s', (_why, username) => {
    expect(usernameSchema.safeParse(username).success).toBe(false);
  });

  it('explains the rule in plain words', () => {
    const result = usernameSchema.safeParse('x');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/3.32 characters/);
  });
});

describe('fullNameSchema', () => {
  it('trims and keeps Tamil text intact', () => {
    expect(fullNameSchema.parse('  ரவி குமார் ')).toBe('ரவி குமார்');
  });

  it('rejects empty, blank and over-long names', () => {
    expect(fullNameSchema.safeParse('').success).toBe(false);
    expect(fullNameSchema.safeParse('   ').success).toBe(false);
    expect(fullNameSchema.safeParse('a'.repeat(101)).success).toBe(false);
    expect(fullNameSchema.safeParse('a'.repeat(100)).success).toBe(true);
  });
});
