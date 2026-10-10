import { describe, expect, it } from 'vitest';
import { urlFromEnv } from './cli.js';

const env = {
  DATABASE_URL: 'postgresql://dev-host/db',
  TEST_DATABASE_URL: 'postgresql://test-host/db',
};

describe('urlFromEnv', () => {
  it('defaults to DATABASE_URL', () => {
    expect(urlFromEnv(undefined, env)).toBe('postgresql://dev-host/db');
  });

  it('reads TEST_DATABASE_URL when asked', () => {
    expect(urlFromEnv('TEST_DATABASE_URL', env)).toBe('postgresql://test-host/db');
  });

  it('rejects any other variable name', () => {
    expect(() => urlFromEnv('PATH', env)).toThrow(/Unknown connection variable/);
  });

  it('explains a missing variable', () => {
    expect(() => urlFromEnv('TEST_DATABASE_URL', {})).toThrow(/TEST_DATABASE_URL is not set/);
  });
});
