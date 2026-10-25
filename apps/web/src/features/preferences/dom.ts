import { msg, translate } from '../../i18n/core';
import type { Language, Theme } from '../../types';

/** Theme = a class on <html>; the CSS swaps every color variable under it (screen only). */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/** <html lang> (screen readers, correct Devanagari shaping) and the window title. */
export function applyLanguage(language: Language): void {
  document.documentElement.lang = language;
  document.title = translate(language, msg('app.title'));
}

/** Id of the operator's serial field (manual entry and the OCR "Detected serial" field). */
export const SERIAL_INPUT_ID = 'serial-input';

/**
 * Puts the keyboard back in the serial field after a display change, so the operator can keep
 * typing or scanning. Returns false when no serial field is on screen (focus is then left alone).
 */
export function focusSerialInput(): boolean {
  const el = document.getElementById(SERIAL_INPUT_ID);
  if (!(el instanceof HTMLInputElement) || el.disabled) return false;
  el.focus();
  return true;
}
