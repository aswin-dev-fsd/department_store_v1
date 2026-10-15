import { describe, expect, it } from 'vitest';
import { formatDateTime } from './dates';

describe('formatDateTime', () => {
  it('shows a stored UTC time as Indian time, whatever timezone the computer is set to', () => {
    // 18:30 UTC is midnight in India (UTC+5:30): the next day
    expect(formatDateTime('2026-10-14T18:30:00.000Z')).toMatch(/^15 Oct 2026,? (at )?12:00\s?am$/i);
    expect(formatDateTime('2026-10-15T07:05:00.000Z')).toMatch(/^15 Oct 2026,? (at )?12:35\s?pm$/i);
  });

  it('returns text that is not a time as it is', () => {
    expect(formatDateTime('not a time')).toBe('not a time');
    expect(formatDateTime('')).toBe('');
  });
});
