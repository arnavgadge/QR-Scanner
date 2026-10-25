/**
 * Timestamp on a PRINTED LABEL. Labels are never translated, so this ignores the UI language and
 * keeps the label's existing format (the device's default locale), but always with Western digits:
 * a device set to Marathi would otherwise print Devanagari digits on the label.
 * On-screen dates use the UI language instead (useI18n().dateTime).
 */
export function formatLabelDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { numberingSystem: 'latn' });
}
