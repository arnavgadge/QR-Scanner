import { LABEL_CODE_LIMITS } from '../../config/label';

/** Why this serial cannot be turned into the company's label code, or null if it can. */
export function labelCodeProblem(codeType: 'barcode' | 'qr', serial: string): string | null {
  if (codeType === 'barcode') {
    if (serial.length > LABEL_CODE_LIMITS.barcodeMaxLength) {
      return `A barcode label can carry at most ${LABEL_CODE_LIMITS.barcodeMaxLength} characters.`;
    }
    for (let i = 0; i < serial.length; i++) {
      const c = serial.charCodeAt(i);
      if (c < 32 || c > 126)
        return 'A barcode label supports only standard keyboard characters (no accents or symbols outside ASCII).';
    }
    return null;
  }
  return serial.length > LABEL_CODE_LIMITS.qrMaxLength
    ? 'This serial is too long for a QR label.'
    : null;
}

/**
 * Serial format patterns (company.serialFormat), e.g. "13WAA#########".
 *   '#'  = exactly one digit 0-9
 *   any other character = that literal character (compared case-insensitively)
 * The serial must match the pattern's length exactly. An empty pattern means "any non-empty
 * serial". This is the placeholder convention for the sample companies; the real production
 * formats are a business decision (see README).
 */
export function validateSerialFormat(serial: string, format: string): boolean {
  const pattern = format.trim();
  if (pattern === '') return serial.length > 0;
  if (serial.length !== pattern.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern.charAt(i);
    const c = serial.charAt(i);
    if (p === '#') {
      if (c < '0' || c > '9') return false;
    } else if (p.toUpperCase() !== c.toUpperCase()) {
      return false;
    }
  }
  return true;
}

// Characters an OCR engine commonly confuses with the character the format expects.
const AS_DIGIT: Record<string, string> = {
  O: '0',
  Q: '0',
  D: '0',
  I: '1',
  L: '1',
  Z: '2',
  S: '5',
  G: '6',
  B: '8',
};
const AS_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B' };

/**
 * A SUGGESTION only: if `serial` has the right length and every mismatch with the format is a
 * well-known look-alike (e.g. letter O where a digit is required), returns the corrected serial.
 * It is shown to the operator as an option and is never applied automatically; the operator still
 * confirms the final value. Returns null when there is no confident single fix.
 */
export function suggestFormatCorrection(serial: string, format: string): string | null {
  const pattern = format.trim();
  if (pattern === '' || serial.length !== pattern.length) return null;
  if (validateSerialFormat(serial, pattern)) return null;
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern.charAt(i);
    const c = serial.charAt(i).toUpperCase();
    if (p === '#') {
      if (c >= '0' && c <= '9') out += c;
      else if (AS_DIGIT[c]) out += AS_DIGIT[c];
      else return null;
    } else if (p.toUpperCase() === c) {
      out += c;
    } else if (AS_LETTER[c] === p.toUpperCase()) {
      out += p.toUpperCase();
    } else {
      return null;
    }
  }
  return validateSerialFormat(out, pattern) ? out : null;
}

/**
 * Live format feedback for an OCR reading under review, for the CURRENTLY selected company's
 * format: whether the text now in the field mismatches, and the look-alike fix (if any) for the
 * ORIGINAL reading. Pure, so the UI can recompute it whenever the company or the text changes.
 */
export function ocrFormatFeedback(
  fieldText: string,
  originalReading: string,
  format: string,
): { mismatch: boolean; suggestion: string | null } {
  const pattern = format.trim();
  if (pattern === '') return { mismatch: false, suggestion: null };
  const current = fieldText.trim().toUpperCase();
  const suggestion = suggestFormatCorrection(originalReading.trim().toUpperCase(), pattern);
  return {
    mismatch: current !== '' && !validateSerialFormat(current, pattern),
    suggestion: suggestion !== null && suggestion !== current ? suggestion : null,
  };
}

export function describeSerialFormat(format: string): string {
  return format.trim() === '' ? 'any serial' : `${format.trim()} (# = digit)`;
}
