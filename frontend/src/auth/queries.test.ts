import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { cashierMe } from '../test/meFixture';
import { fetchMe } from './queries';

const meta = { timestamp: '2026-10-10T00:00:00.000Z', version: '0.1.0' };

function reply(body: unknown, status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
}

const failure = (code: string, status: number) =>
  reply({ success: false, error: { code, message: 'no' }, meta }, status);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchMe', () => {
  it('returns the profile for a logged-in visitor', async () => {
    reply({ success: true, data: cashierMe(), meta }, 200);
    await expect(fetchMe()).resolves.toEqual(cashierMe());
  });

  it('returns null, not an error, when nobody is logged in', async () => {
    failure('UNAUTHORIZED', 401);
    await expect(fetchMe()).resolves.toBeNull();
  });

  it('still throws when a session existed but ended, so the reason can be shown', async () => {
    failure('SESSION_EXPIRED', 401);
    await expect(fetchMe()).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    failure('ACCOUNT_DISABLED', 401);
    await expect(fetchMe()).rejects.toBeInstanceOf(ApiError);
  });

  it('throws when the server cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    await expect(fetchMe()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
