import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { failure, success } from './response.js';

const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

describe('success envelope (DreamLand §7)', () => {
  it('wraps data with meta', () => {
    const body = success({ status: 'ok' });
    expect(body).toEqual({
      success: true,
      data: { status: 'ok' },
      meta: { timestamp: expect.any(String), version },
    });
  });

  it('stamps an ISO-8601 timestamp', () => {
    const { timestamp } = success(null).meta;
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
  });
});

describe('failure envelope', () => {
  it('omits details when there are none', () => {
    const body = failure('NOT_FOUND', 'Item not found');
    expect(body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Item not found' },
      meta: { timestamp: expect.any(String), version },
    });
    expect('details' in body.error).toBe(false);
  });

  it('includes details when given', () => {
    const details = [{ path: 'quantity', message: 'Must be at least 1' }];
    expect(failure('VALIDATION_ERROR', 'Invalid input', details).error.details).toEqual(details);
  });
});
