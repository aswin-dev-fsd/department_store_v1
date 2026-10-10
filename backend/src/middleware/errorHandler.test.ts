import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, NotFoundError } from '../lib/errors.js';
import { errorHandler } from './errorHandler.js';

/** A tiny app whose routes throw, wired to the real error handler. */
function appThrowing(error: unknown) {
  const app = express();
  app.get('/sync', () => {
    throw error;
  });
  app.get('/async', async () => {
    await Promise.resolve();
    throw error;
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('turns an AppError into its status, code and details', async () => {
    const details = [{ itemId: 1, available: 3, requested: 10 }];
    const res = await request(
      appThrowing(new AppError('INSUFFICIENT_STOCK', 'Not enough stock', details)),
    ).get('/sync');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'INSUFFICIENT_STOCK', message: 'Not enough stock', details },
      meta: { timestamp: expect.any(String), version: expect.any(String) },
    });
  });

  it('handles errors from async handlers too', async () => {
    const res = await request(appThrowing(new NotFoundError('Bill not found'))).get('/async');
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: 'NOT_FOUND', message: 'Bill not found' });
  });

  it('turns a ZodError into 422 with field details', async () => {
    const parsed = z.object({ quantity: z.number().int().min(1) }).safeParse({ quantity: 0 });
    const res = await request(appThrowing(parsed.error)).get('/sync');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([{ path: 'quantity', message: expect.any(String) }]);
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const res = await request(
      appThrowing(new Error('connection to db-host failed: password=hunter2')),
    ).get('/sync');
    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Something went wrong' });
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|db-host|at .*\.ts/);
  });
});
