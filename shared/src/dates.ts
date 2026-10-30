// Business dates and financial years (overview §5.4; AGENTS.md → Time). Times are stored in UTC;
// the business runs on India time. IST is a fixed UTC+05:30 with no daylight saving, so shifting
// by the offset and reading the UTC fields gives the IST calendar without a date library.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The same instant shifted so that its UTC fields read as the IST wall clock. */
function istFields(at: Date): Date {
  const time = at.getTime();
  if (Number.isNaN(time)) {
    throw new RangeError('Expected a valid date');
  }
  return new Date(time + IST_OFFSET_MS);
}

/** The IST calendar date of an instant, as YYYY-MM-DD: a bill at 11:30 PM IST is that day's. */
export function businessDate(at: Date): string {
  return istFields(at).toISOString().slice(0, 10);
}

/**
 * The financial year (1 April – 31 March, IST) an instant falls in, as two two-digit years:
 * April 2026 – March 2027 is '26-27'.
 */
export function financialYear(at: Date): string {
  const ist = istFields(at);
  // Months count from 0, so 3 is April
  const startYear = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  const twoDigits = (year: number) => String(year % 100).padStart(2, '0');
  return `${twoDigits(startYear)}-${twoDigits(startYear + 1)}`;
}
