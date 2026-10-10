import { createRequire } from 'node:module';
import type { ApiFailure, ApiMeta, ApiSuccess } from '@ds/shared';

// backend/package.json is two levels up from both src/lib and dist/lib
const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

function meta(): ApiMeta {
  return { timestamp: new Date().toISOString(), version };
}

/** Wrap response data in the success envelope (DreamLand §7). */
export function success<T>(data: T): ApiSuccess<T> {
  return { success: true, data, meta: meta() };
}

/** Build the failure envelope; `details` is left out when there are none. */
export function failure(code: string, message: string, details?: unknown): ApiFailure {
  return {
    success: false,
    error: details === undefined ? { code, message } : { code, message, details },
    meta: meta(),
  };
}
