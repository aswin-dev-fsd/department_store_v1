import type { ApiResponse } from '@ds/shared';

// Same origin in every environment: Vite's dev proxy locally, Vercel's rewrite when deployed
const API_BASE = '/api/v1';

/** A failed API call: an error envelope, an unreachable server, or a non-JSON reply. */
export class ApiError extends Error {
  readonly code: string;
  /** HTTP status; 0 when the server couldn't be reached. */
  readonly status: number;
  readonly details: unknown;

  constructor(
    code: string,
    message: string,
    status: number,
    details?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** A request body already turned into text, with the Content-Type to send it under. */
interface TextBody {
  contentType: string;
  text: string;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  return send<T>(
    method,
    path,
    body === undefined
      ? undefined
      : { contentType: 'application/json', text: JSON.stringify(body) },
  );
}

async function send<T>(method: string, path: string, body?: TextBody): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers:
        body === undefined
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': body.contentType },
      body: body?.text,
    });
  } catch (error) {
    throw new ApiError('NETWORK_ERROR', 'Could not reach the server', 0, undefined, {
      cause: error,
    });
  }

  let envelope: ApiResponse<T>;
  try {
    envelope = (await response.json()) as ApiResponse<T>;
  } catch (error) {
    throw new ApiError(
      'BAD_RESPONSE',
      `Unexpected reply from the server (HTTP ${response.status})`,
      response.status,
      undefined,
      { cause: error },
    );
  }

  if (!envelope.success) {
    const { code, message, details } = envelope.error;
    throw new ApiError(code, message, response.status, details);
  }
  return envelope.data;
}

/** Typed calls to the backend. Each resolves to the envelope's `data` or throws ApiError. */
export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  /** POST a CSV file's text as it is, with Content-Type text/csv (the CSV import). */
  postCsv: <T>(path: string, csv: string) =>
    send<T>('POST', path, { contentType: 'text/csv', text: csv }),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
