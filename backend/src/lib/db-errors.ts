const UNIQUE_VIOLATION = '23505';

/**
 * The PostgreSQL error code of a failed query (e.g. '23505'), or undefined if the error did not
 * come from the database. Drizzle wraps the driver's error, so this looks through `cause`.
 */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Whether a database error is a unique-constraint violation (a duplicate). */
export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === UNIQUE_VIOLATION;
}
