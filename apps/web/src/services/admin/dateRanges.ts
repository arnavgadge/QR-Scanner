/**
 * Time-zone convention for the admin area (explicit, never mixed):
 *  - Firestore stores server timestamps (absolute instants).
 *  - "Today" and the history date filters use the ADMIN'S LOCAL calendar day (their browser's time
 *    zone), the same zone the rest of the UI displays. The zone name is shown next to them.
 *  - The Excel export is the exception: it is labelled UTC.
 */

/** Local midnight today (inclusive) and local midnight tomorrow (exclusive). */
export function localDayRange(now: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { start, end };
}

export function timeZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  } catch {
    return 'local time';
  }
}

/** 'YYYY-MM-DD' (from <input type="date">) -> local midnight of that day, or null if invalid. */
export function parseDateInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d
    ? date
    : null;
}

/** Inclusive date range from two date inputs -> [start, end) in local time. */
export function inclusiveRange(from: string, to: string): { from?: Date; to?: Date } {
  const start = from ? parseDateInput(from) : null;
  const last = to ? parseDateInput(to) : null;
  return {
    ...(start ? { from: start } : {}),
    ...(last ? { to: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1) } : {}),
  };
}
