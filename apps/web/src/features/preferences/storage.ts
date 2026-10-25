import { DEFAULT_LANGUAGE, isLanguage } from '../../i18n/core';
import type { Language, Theme } from '../../types';

/** The display choices the app applies: always complete (no undefined). */
export interface DisplayPreferences {
  language: Language;
  theme: Theme;
}

export const DEFAULT_PREFERENCES: DisplayPreferences = {
  language: DEFAULT_LANGUAGE,
  theme: 'light',
};

const STORAGE_KEY = 'serial-scanning.display-preferences';

/**
 * This device's last choice (used before sign-in, and when the account has none saved). Storage
 * can be unavailable (private mode, blocked site data, kiosk policies): every access is guarded and
 * the defaults are used instead.
 */
export function readStoredPreferences(): DisplayPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return DEFAULT_PREFERENCES;
    const p = v as Record<string, unknown>;
    return {
      language: isLanguage(p.language) ? p.language : DEFAULT_PREFERENCES.language,
      theme: p.theme === 'dark' || p.theme === 'light' ? p.theme : DEFAULT_PREFERENCES.theme,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function storePreferences(prefs: DisplayPreferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Not persisted on this device; the choice still applies for this session.
  }
}
