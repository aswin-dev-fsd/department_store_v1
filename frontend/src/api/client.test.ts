import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './client';

const meta = { timestamp: '2026-10-10T00:00:00.000Z', version: '0.1.0' };

function respondWith(body: unknown, status = 200, contentType = 'application/json') {
  const fetchMock = vi.fn(
    async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': contentType },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('GETs under /api/v1 with cookies and unwraps data from the envelope', async () => {
    const fetchMock = respondWith({ success: true, data: { status: 'ok' }, meta });
    await expect(api.get('/health')).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/health',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('POSTs a JSON body', async () => {
    const fetchMock = respondWith({ success: true, data: { id: 1 }, meta }, 201);
    await api.post('/bills', { lines: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/bills',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ lines: [] }),
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('throws ApiError carrying the code, message, details and status of an error envelope', async () => {
    const details = [{ itemId: 7, available: 0, requested: 1 }];
    respondWith(
      {
        success: false,
        error: { code: 'INSUFFICIENT_STOCK', message: 'Not enough stock', details },
        meta,
      },
      400,
    );
    const error = await api.post('/bills', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      message: 'Not enough stock',
      details,
      status: 400,
    });
  });

  it('reports an unreachable server as NETWORK_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(api.get('/health')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('reports a non-JSON reply (e.g. a proxy timeout page) as BAD_RESPONSE with its status', async () => {
    respondWith('An error occurred: ROUTER_EXTERNAL_TARGET_ERROR', 504, 'text/plain');
    await expect(api.get('/health')).rejects.toMatchObject({ code: 'BAD_RESPONSE', status: 504 });
  });
});
