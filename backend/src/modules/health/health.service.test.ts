import type { Db } from '@ds/database';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../lib/logger.js';
import { checkHealth } from './health.service.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkHealth', () => {
  it('reports the database down — and logs why — when the ping times out', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const hangingDb = { execute: () => new Promise(() => {}) } as unknown as Db;

    const health = await checkHealth(hangingDb, { timeoutMs: 50 });

    expect(health).toMatchObject({ status: 'ok', database: 'down' });
    expect(warn).toHaveBeenCalledWith({ timeoutMs: 50 }, 'Database ping timed out');
  });

  it('reports the database down — and logs the error — when the ping fails', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const failure = new Error('connection refused');
    const failingDb = { execute: () => Promise.reject(failure) } as unknown as Db;

    const health = await checkHealth(failingDb, { timeoutMs: 1_000 });

    expect(health.database).toBe('down');
    expect(warn).toHaveBeenCalledWith({ err: failure }, 'Database ping failed');
  });
});
