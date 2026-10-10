import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { failure } from '../lib/response.js';

// Errors raised by express.json() for bad client input, keyed by their `type`
const BODY_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  'entity.parse.failed': {
    status: 400,
    code: 'INVALID_JSON',
    message: 'Request body is not valid JSON',
  },
  'entity.too.large': {
    status: 413,
    code: 'PAYLOAD_TOO_LARGE',
    message: 'Request body is too large',
  },
};

/**
 * Turn any thrown error into the failure envelope (DreamLand §7–8). Typed errors keep their
 * status and code; anything unexpected is logged in full and answered with a generic 500.
 */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof AppError) {
    res.status(err.statusCode).json(failure(err.code, err.message, err.details));
    return;
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    res.status(422).json(failure('VALIDATION_ERROR', 'Invalid request data', details));
    return;
  }
  const bodyError =
    typeof err === 'object' && err !== null && 'type' in err
      ? BODY_ERRORS[String(err.type)]
      : undefined;
  if (bodyError) {
    res.status(bodyError.status).json(failure(bodyError.code, bodyError.message));
    return;
  }
  (req.log ?? logger).error({ err }, 'Unhandled error');
  res.status(500).json(failure('INTERNAL_ERROR', 'Something went wrong'));
};
