import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.schema.js';

const DB = 'postgresql://owner:s3cret-pass@ep-x.aws.neon.tech/neondb?sslmode=require';

describe('parseEnv — defaults', () => {
  it('needs only DATABASE_URL in development and fills sensible defaults', () => {
    const env = parseEnv({ DATABASE_URL: DB });
    expect(env).toEqual({
      NODE_ENV: 'development',
      PORT: 4000,
      DATABASE_URL: DB,
      TEST_DATABASE_URL: undefined,
      CORS_ORIGIN: ['http://localhost:5173'],
      SESSION_TTL_HOURS: 12,
      COOKIE_SECURE: false,
      LOG_LEVEL: 'info',
    });
  });

  it('parses numbers, booleans and comma-separated origins', () => {
    const env = parseEnv({
      DATABASE_URL: DB,
      PORT: '8080',
      SESSION_TTL_HOURS: '8',
      COOKIE_SECURE: 'true',
      CORS_ORIGIN: 'https://a.example.com, https://b.example.com',
    });
    expect(env.PORT).toBe(8080);
    expect(env.SESSION_TTL_HOURS).toBe(8);
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.CORS_ORIGIN).toEqual(['https://a.example.com', 'https://b.example.com']);
  });
});

describe('parseEnv — rejects bad input', () => {
  it('names a missing DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-PostgreSQL URL', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://u:p@host/db' })).toThrow(/DATABASE_URL/);
  });

  it.each([
    ['PORT', 'abc'],
    ['COOKIE_SECURE', 'yes'],
    ['NODE_ENV', 'staging'],
    ['LOG_LEVEL', 'loud'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => parseEnv({ DATABASE_URL: DB, [name]: value })).toThrow(new RegExp(name));
  });

  it('never echoes secret values in the error message', () => {
    try {
      parseEnv({ DATABASE_URL: DB, TEST_DATABASE_URL: 'mysql://u:other-s3cret@h/db' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(String(error)).not.toContain('s3cret');
    }
  });
});

describe('parseEnv — production safety (DreamLand §9)', () => {
  const prod = {
    NODE_ENV: 'production',
    DATABASE_URL: DB,
    CORS_ORIGIN: 'https://store.example.com',
    COOKIE_SECURE: 'true',
  };

  it('accepts a complete production config', () => {
    expect(parseEnv(prod).CORS_ORIGIN).toEqual(['https://store.example.com']);
  });

  it('requires CORS_ORIGIN in production', () => {
    expect(() => parseEnv({ ...prod, CORS_ORIGIN: undefined })).toThrow(/CORS_ORIGIN/);
  });

  it('refuses a wildcard CORS origin in production', () => {
    expect(() => parseEnv({ ...prod, CORS_ORIGIN: '*' })).toThrow(/CORS_ORIGIN/);
  });

  it('requires secure cookies in production', () => {
    expect(() => parseEnv({ ...prod, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
  });
});
