import { OCR_MAX_SERIAL_LENGTH, OCR_MIN_SERIAL_LENGTH } from '../../config/ocr';
import { normalizeSerial } from '../../utils/serial';
import type { OCRCandidate, OCRResult } from './types';

export interface PickedCandidate {
  text: string;
  confidence?: number;
  /** Other plausible readings (best first), so the operator can swap in a better one. */
  alternatives: OCRCandidate[];
  /** Whether the pick satisfies the supplied `fits` predicate (undefined if none was supplied). */
  matchesFormat?: boolean;
}

/**
 * Keeps only characters a serial can contain. Deliberately does NOT "fix" look-alikes
 * (O/0, I/1, ...): changing characters could produce a different, valid-looking serial.
 */
export function cleanFragment(raw: string): string {
  return normalizeSerial(raw.replace(/\s+/g, ''))
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/^-+|-+$/g, '');
}

/**
 * Chooses the most serial-like fragment of an OCR result. This is selection only: the operator
 * still sees, edits and confirms the value, and the normal verification validates it.
 * If a `fits` predicate is supplied (e.g. the company's serial format check), fragments that fit it
 * win; otherwise the longest fragment wins. This module knows nothing about formats or companies.
 */
export function pickSerialCandidate(
  result: OCRResult,
  fits?: (text: string) => boolean,
): PickedCandidate | null {
  const pool: OCRCandidate[] = [
    ...result.candidates,
    { text: result.text, confidence: result.confidence },
  ];
  const best = new Map<string, number | undefined>();
  for (const c of pool) {
    const text = cleanFragment(c.text);
    if (text.length < OCR_MIN_SERIAL_LENGTH || text.length > OCR_MAX_SERIAL_LENGTH) continue;
    const prev = best.get(text);
    if (
      !best.has(text) ||
      (c.confidence !== undefined && (prev === undefined || c.confidence > prev))
    ) {
      best.set(text, c.confidence);
    }
  }
  const hasFormat = fits !== undefined;
  const ranked = [...best.entries()]
    .map(([text, confidence]) => ({
      text,
      confidence,
      fits: fits ? fits(text) : false,
      // Serial-like = letters AND digits (prefers "13WAA000000401" over "MADEINGERMANY").
      mixed: /[A-Z]/.test(text) && /[0-9]/.test(text),
    }))
    .sort(
      (a, b) =>
        Number(b.fits) - Number(a.fits) ||
        Number(b.mixed) - Number(a.mixed) ||
        b.text.length - a.text.length ||
        (b.confidence ?? -1) - (a.confidence ?? -1) ||
        (a.text < b.text ? -1 : 1),
    );
  const top = ranked[0];
  if (!top) return null;
  return {
    text: top.text,
    ...(top.confidence !== undefined ? { confidence: top.confidence } : {}),
    alternatives: ranked.slice(1, 4).map(({ text, confidence }) => ({
      text,
      ...(confidence !== undefined ? { confidence } : {}),
    })),
    ...(hasFormat ? { matchesFormat: top.fits } : {}),
  };
}
