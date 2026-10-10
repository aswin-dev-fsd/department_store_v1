// The response envelope every API route returns (DreamLand §7).
// Shared so the backend builds it and the frontend reads it with the same types.

export interface ApiMeta {
  /** ISO-8601 time the response was built. */
  timestamp: string;
  /** Backend package version. */
  version: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
  meta: ApiMeta;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
