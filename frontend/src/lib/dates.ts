// The business runs on Indian time (AGENTS.md → Time): stored times are UTC, shown in Asia/Kolkata
// whatever timezone the computer is set to.
const formatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** A stored timestamp (ISO text) as Indian time, like "15 Oct 2026, 12:00 am". Unreadable text is returned as it is. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : formatter.format(date);
}
