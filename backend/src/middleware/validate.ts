import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { ValidationError } from '../lib/errors.js';

export interface RequestSchemas {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
}

const PARTS = ['params', 'query', 'body'] as const;

/**
 * Validate request parts with zod and replace them with the parsed values (numbers coerced,
 * defaults filled, unknown fields dropped). On failure: 422 VALIDATION_ERROR listing every
 * problem as { path: 'body.quantity', message }.
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    const details: { path: string; message: string }[] = [];
    const parsed: Partial<Record<(typeof PARTS)[number], unknown>> = {};

    for (const part of PARTS) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (result.success) {
        parsed[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          details.push({
            path: [part, ...issue.path.map(String)].join('.'),
            message: issue.message,
          });
        }
      }
    }
    if (details.length > 0) {
      throw new ValidationError('Invalid request data', details);
    }

    for (const part of PARTS) {
      if (!(part in parsed)) continue;
      // Express 5 serves req.query from a getter; an own property shadows it
      Object.defineProperty(req, part, {
        value: parsed[part],
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    next();
  };
}
