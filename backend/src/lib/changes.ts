export interface Changes<T> {
  before: Partial<T>;
  after: Partial<T>;
}

/**
 * Compare the fields given in `patch` with `current`. An undefined field means "leave as it is".
 * Returns the old and new value of only the fields that really differ (the before/after of an
 * audit row), or null when nothing would change, so the caller can skip the update and the
 * audit row. Compares with `!==`, which is right for the strings, booleans and nulls it is for.
 */
export function changedFields<T extends object>(current: T, patch: Partial<T>): Changes<T> | null {
  const before: Partial<T> = {};
  const after: Partial<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const next = patch[key];
    if (next === undefined || next === current[key]) continue;
    before[key] = current[key];
    after[key] = next;
  }
  return Object.keys(after).length === 0 ? null : { before, after };
}
