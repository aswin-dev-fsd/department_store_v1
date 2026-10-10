import { describe, expect, it } from 'vitest';
import {
  createUserSchema,
  fullNameSchema,
  listUsersQuerySchema,
  setUserBranchesSchema,
  updateUserSchema,
  usernameSchema,
} from './users.js';

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

describe('createUserSchema', () => {
  const valid = { username: 'Ravi.K', fullName: ' Ravi Kumar ', role: 'cashier' };

  it('normalises the username and name, and takes a role', () => {
    expect(createUserSchema.parse(valid)).toEqual({
      username: 'ravi.k',
      fullName: 'Ravi Kumar',
      role: 'cashier',
    });
    expect(createUserSchema.parse({ ...valid, role: 'admin' }).role).toBe('admin');
  });

  it('needs all three fields and a known role', () => {
    expect(createUserSchema.safeParse({ ...valid, role: 'owner' }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...valid, role: undefined }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...valid, username: 'a b' }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...valid, fullName: '  ' }).success).toBe(false);
  });

  it('does not accept a password: the server makes the temporary one', () => {
    const parsed = createUserSchema.parse({ ...valid, password: 'chosen-by-client' });
    expect('password' in parsed).toBe(false);
  });
});

describe('updateUserSchema', () => {
  it('takes a new name and/or an active flag', () => {
    expect(updateUserSchema.parse({ fullName: ' New Name ' })).toEqual({ fullName: 'New Name' });
    expect(updateUserSchema.parse({ isActive: false })).toEqual({ isActive: false });
  });

  it('refuses an empty body, and does not take a role or username (they are fixed in v1)', () => {
    expect(updateUserSchema.safeParse({}).success).toBe(false);
    expect(updateUserSchema.safeParse({ role: 'admin' }).success).toBe(false);
    expect(updateUserSchema.parse({ fullName: 'A', role: 'admin', username: 'x' })).toEqual({
      fullName: 'A',
    });
  });

  it('refuses a blank name and a non-boolean flag', () => {
    expect(updateUserSchema.safeParse({ fullName: '  ' }).success).toBe(false);
    expect(updateUserSchema.safeParse({ isActive: 'no' }).success).toBe(false);
  });
});

describe('setUserBranchesSchema', () => {
  it('takes a list of branch ids, which may be empty', () => {
    expect(setUserBranchesSchema.parse({ branchIds: [3, 1] })).toEqual({ branchIds: [3, 1] });
    expect(setUserBranchesSchema.parse({ branchIds: [] })).toEqual({ branchIds: [] });
  });

  it('refuses anything but positive whole numbers, and a missing list', () => {
    for (const branchIds of [[0], [-1], [1.5], ['1'], [null], 'all', undefined]) {
      expect(setUserBranchesSchema.safeParse({ branchIds }).success).toBe(false);
    }
    expect(setUserBranchesSchema.safeParse({}).success).toBe(false);
  });

  it('allows at most 100 branches', () => {
    expect(
      setUserBranchesSchema.safeParse({ branchIds: Array.from({ length: 100 }, (_, i) => i + 1) })
        .success,
    ).toBe(true);
    expect(
      setUserBranchesSchema.safeParse({ branchIds: Array.from({ length: 101 }, (_, i) => i + 1) })
        .success,
    ).toBe(false);
  });
});

describe('listUsersQuerySchema', () => {
  it('has paging defaults and optional role and isActive filters read from text', () => {
    expect(listUsersQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
    const filtered = listUsersQuerySchema.parse({ role: 'cashier', isActive: 'false', limit: '5' });
    expect(filtered).toEqual({ limit: 5, offset: 0, role: 'cashier', isActive: false });
  });

  it('refuses an unknown role or flag', () => {
    expect(listUsersQuerySchema.safeParse({ role: 'owner' }).success).toBe(false);
    expect(listUsersQuerySchema.safeParse({ isActive: 'maybe' }).success).toBe(false);
  });
});
