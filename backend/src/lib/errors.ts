// Typed errors (DreamLand §8). The error handler turns them into the failure envelope.

/** A business-rule violation (400) with a specific code, e.g. INSUFFICIENT_STOCK. */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: unknown;

  constructor(code: string, message: string, details?: unknown, statusCode = 400) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

/** Request input failed its schema (422). */
export class ValidationError extends AppError {
  constructor(message = 'Invalid request data', details?: unknown) {
    super('VALIDATION_ERROR', message, details, 422);
  }
}

/** Missing or invalid session (401). */
export class AuthError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED') {
    super(code, message, undefined, 401);
  }
}

/** Logged in, but not allowed to do this (403). */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do this', code = 'FORBIDDEN') {
    super(code, message, undefined, 403);
  }
}

/** Record doesn't exist — or isn't visible from the active branch (404). */
export class NotFoundError extends AppError {
  constructor(message = 'Not found', code = 'NOT_FOUND') {
    super(code, message, undefined, 404);
  }
}
