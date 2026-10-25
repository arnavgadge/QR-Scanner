export interface NormalizeOptions {
  /** Preserve letter case when a company's serial format is case-sensitive. Default: false. */
  caseSensitive?: boolean;
}

/**
 * Conservative serial normalization: trims surrounding whitespace and (unless the format is
 * case-sensitive) upper-cases. Deliberately does NOT touch look-alike characters (O/0, I/1)
 * or inner characters — those decisions belong to validation/OCR phases.
 */
export function normalizeSerial(raw: string, { caseSensitive = false }: NormalizeOptions = {}) {
  const trimmed = raw.trim();
  return caseSensitive ? trimmed : trimmed.toUpperCase();
}
