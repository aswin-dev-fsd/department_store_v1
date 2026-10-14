import { ApiError } from '../api/client';

/** One message per field name. */
export type FieldErrors = Record<string, string>;

/** The part of a zod schema a form needs — so the frontend doesn't depend on zod itself. */
interface FormSchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: readonly FormIssue[] } };
}

interface FormIssue {
  path: readonly PropertyKey[];
  message: string;
}

export type FormResult<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors };

/**
 * Check form values against a schema from @ds/shared — the same one the server applies.
 * On failure returns the first problem of each field.
 */
export function validateForm<T>(schema: FormSchema<T>, values: unknown): FormResult<T> {
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };

  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? '');
    if (field && !(field in errors)) errors[field] = issue.message;
  }
  return { ok: false, errors };
}

/** Field messages from a server 422 (details: [{ path: 'body.field', message }]). */
export function serverFieldErrors(error: unknown): FieldErrors {
  const errors: FieldErrors = {};
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return errors;

  for (const detail of error.details as unknown[]) {
    if (typeof detail !== 'object' || detail === null) continue;
    const { path, message } = detail as { path?: unknown; message?: unknown };
    if (typeof path !== 'string' || typeof message !== 'string') continue;
    const [part, field] = path.split('.');
    if (part === 'body' && field && !(field in errors)) errors[field] = message;
  }
  return errors;
}
