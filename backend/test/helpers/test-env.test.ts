import { describe, expect, it } from 'vitest';
import { databaseIdentity, resolveTestDatabaseUrl } from './test-env.js';

const DEV = 'postgresql://owner:dev-pass@ep-dev-1.aws.neon.tech/neondb?sslmode=require';
const TEST = 'postgresql://owner:test-pass@ep-test-2.aws.neon.tech/neondb?sslmode=require';

describe('databaseIdentity', () => {
  it('identifies a database by host, port and name only', () => {
    expect(databaseIdentity(DEV)).toBe('ep-dev-1.aws.neon.tech:5432/neondb');
    expect(databaseIdentity('postgresql://a:b@localhost:6543/shop')).toBe('localhost:6543/shop');
  });
});

describe('resolveTestDatabaseUrl — the guard', () => {
  it('returns TEST_DATABASE_URL when it is a different database', () => {
    expect(resolveTestDatabaseUrl({ DATABASE_URL: DEV, TEST_DATABASE_URL: TEST })).toBe(TEST);
  });

  it('refuses when TEST_DATABASE_URL is missing', () => {
    expect(() => resolveTestDatabaseUrl({ DATABASE_URL: DEV })).toThrow(
      /TEST_DATABASE_URL is not set/,
    );
  });

  it('refuses when both point at the same database', () => {
    expect(() => resolveTestDatabaseUrl({ DATABASE_URL: DEV, TEST_DATABASE_URL: DEV })).toThrow(
      /Refusing to run tests/,
    );
  });

  it('still refuses when only the password or options differ', () => {
    const sameDbOtherCredentials =
      'postgresql://someone:else@ep-dev-1.aws.neon.tech/neondb?sslmode=verify-full';
    expect(() =>
      resolveTestDatabaseUrl({ DATABASE_URL: DEV, TEST_DATABASE_URL: sameDbOtherCredentials }),
    ).toThrow(/Refusing to run tests/);
  });

  it('never prints either URL in its message', () => {
    try {
      resolveTestDatabaseUrl({ DATABASE_URL: DEV, TEST_DATABASE_URL: DEV });
    } catch (error) {
      expect(String(error)).not.toMatch(/dev-pass|ep-dev-1/);
    }
  });
});
