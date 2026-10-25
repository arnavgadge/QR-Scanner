import { enText, msg, type Msg } from '../../i18n/core';

/**
 * The ONE place that decides whether a serial VALUE can be stored, whatever way it arrives
 * (manual entry, a confirmed OCR reading, or an Excel import row). Pure: no Firebase, no DOM.
 * Company-specific rules (serial format, label code limits) live in serialFormat.ts.
 */

/**
 * Longest serial the database accepts: firestore.rules caps `scan_log.serial` at 100 characters, so
 * a longer serial could never be registered by an operator. Keep both in sync.
 */
export const MAX_SERIAL_LENGTH = 100;

/** Longest part number the rules accept (`serials.part_no`). */
export const MAX_PART_LENGTH = 100;

/** Firestore's hard limit for a document ID. */
const MAX_DOC_ID_BYTES = 1500;

/**
 * Why `serial` cannot be a Firestore document ID, or null if it can. Firestore IDs cannot be
 * empty, '.', '..', contain '/', match the reserved `__.*__` pattern, or exceed 1,500 bytes.
 */
export function serialIdProblem(serial: string): string | null {
  const problem = serialIdProblemMsg(serial);
  return problem ? enText(problem) : null;
}

function serialIdProblemMsg(serial: string): Msg | null {
  if (
    !serial ||
    serial === '.' ||
    serial === '..' ||
    serial.includes('/') ||
    /^__.*__$/.test(serial)
  ) {
    return msg('serial.badCharacters');
  }
  if (new TextEncoder().encode(serial).length > MAX_DOC_ID_BYTES) {
    return msg('serial.idTooLong');
  }
  return null;
}

/** `message` is the English text; `msg` the same message for the UI to translate. */
export type SerialValueProblem = { code: 'too-long' | 'characters'; message: string; msg: Msg };

/** Length and storability of an already-normalized, non-empty serial. null = acceptable. */
export function serialValueProblem(serial: string): SerialValueProblem | null {
  if (serial.length > MAX_SERIAL_LENGTH) {
    const m = msg('serial.tooLong', { max: MAX_SERIAL_LENGTH });
    return { code: 'too-long', message: enText(m), msg: m };
  }
  const id = serialIdProblemMsg(serial);
  return id ? { code: 'characters', message: enText(id), msg: id } : null;
}
