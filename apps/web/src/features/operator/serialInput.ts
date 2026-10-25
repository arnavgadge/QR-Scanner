import type { MessageKey } from '../../i18n';

/**
 * Why typed or pasted text was refused by the serial field:
 *  'non-ascii'     anything outside plain ASCII: almost always a Hindi/Marathi (Devanagari)
 *                  keyboard layout, which also turns digits into ०-९. The fix is to switch the
 *                  keyboard to English, so that is what the message says.
 *  'invalid-char'  an ASCII character that can never be part of a serial (e.g. "-", "/", ".").
 */
export type SerialInputProblem = 'non-ascii' | 'invalid-char';

export const SERIAL_INPUT_MESSAGES: Record<SerialInputProblem, MessageKey> = {
  'non-ascii': 'serialInput.nonAscii',
  'invalid-char': 'serialInput.invalidChar',
};

export type ScreenedSerialInput =
  { accepted: true; value: string } | { accepted: false; problem: SerialInputProblem };

/**
 * Screens the serial field's new value: only A-Z and 0-9 are accepted. Letters are upper-cased
 * and whitespace is dropped (a pasted value often carries a trailing space or line break).
 * Anything else is refused as a whole, so the field keeps its previous value and nothing is
 * silently altered. Serials are never translated or transliterated.
 */
export function screenSerialInput(raw: string): ScreenedSerialInput {
  const compact = raw.replace(/\s+/g, '');
  if (/[^\x20-\x7e]/.test(compact)) return { accepted: false, problem: 'non-ascii' };
  if (/[^A-Za-z0-9]/.test(compact)) return { accepted: false, problem: 'invalid-char' };
  return { accepted: true, value: compact.toUpperCase() };
}
