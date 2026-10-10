import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

function captureLogs() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      done();
    },
  });
  return { lines, logger: createLogger('info', stream) };
}

describe('createLogger', () => {
  it('writes structured JSON at or above the level', () => {
    const { lines, logger } = captureLogs();
    logger.debug('hidden');
    logger.info({ billId: 7 }, 'bill saved');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: 'bill saved', billId: 7 });
  });

  it('redacts passwords, tokens, cookies and auth headers', () => {
    const { lines, logger } = captureLogs();
    logger.info({
      password: 'top-secret',
      user: { password: 'nested-secret', name: 'Ravi' },
      token: 'session-token',
      req: {
        headers: {
          cookie: 'ds_session=abc',
          authorization: 'Bearer xyz',
          // Vercel adds this to requests it proxies (seen in Render's logs, Task 2.5)
          'x-vercel-proxy-signature': 'Bearer vercel-signature-value',
        },
      },
    });
    const text = JSON.stringify(lines[0]);
    for (const secret of [
      'top-secret',
      'nested-secret',
      'session-token',
      'ds_session=abc',
      'Bearer xyz',
      'vercel-signature-value',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('Ravi');
    expect(text).toContain('[redacted]');
  });
});
