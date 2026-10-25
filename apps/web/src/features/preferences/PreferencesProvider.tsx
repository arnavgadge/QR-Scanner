import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { I18nContext, makeI18n } from '../../i18n';
import { dataService } from '../../data';
import type { Language, Theme, UserPreferences } from '../../types';
import { logWarn } from '../../utils/log';
import { applyLanguage, applyTheme } from './dom';
import { PreferencesContext, type PreferencesContextValue } from './PreferencesContext';
import { readStoredPreferences, storePreferences, type DisplayPreferences } from './storage';

/**
 * Owns the UI language and theme. Sources, in order: the signed-in account's saved choice
 * (users/{uid}.preferences, applied once per sign-in), else this device's last choice
 * (localStorage), else English + light. Every change is kept on the device and, when signed in,
 * saved to the account in the background: saving never blocks or interrupts the operator.
 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<DisplayPreferences>(readStoredPreferences);
  const current = useRef(prefs); // latest value for callbacks (no stale closures)
  const accountUid = useRef<string | null>(null);

  // Before paint, so a change never flashes the old theme/language.
  useLayoutEffect(() => applyTheme(prefs.theme), [prefs.theme]);
  useLayoutEffect(() => applyLanguage(prefs.language), [prefs.language]);

  const commit = useCallback((next: DisplayPreferences, saveToAccount: boolean) => {
    current.current = next;
    // Applied to the DOM immediately as well, so a view transition captures the new theme.
    applyTheme(next.theme);
    applyLanguage(next.language);
    setPrefs(next);
    storePreferences(next);
    const uid = accountUid.current;
    if (saveToAccount && uid) {
      dataService
        .saveUserPreferences(uid, next)
        .catch((e: unknown) => logWarn('Display preferences were not saved to the account', e));
    }
  }, []);

  const setLanguage = useCallback(
    (language: Language) => {
      if (language !== current.current.language) commit({ ...current.current, language }, true);
    },
    [commit],
  );

  const setTheme = useCallback(
    (theme: Theme) => {
      if (theme !== current.current.theme) commit({ ...current.current, theme }, true);
    },
    [commit],
  );

  const bindAccount = useCallback(
    (uid: string | null, saved?: UserPreferences) => {
      accountUid.current = uid;
      if (!uid || !saved) return;
      const next: DisplayPreferences = {
        language: saved.language ?? current.current.language,
        theme: saved.theme ?? current.current.theme,
      };
      if (next.language !== current.current.language || next.theme !== current.current.theme) {
        commit(next, false); // it came from the account; nothing to save back
      }
    },
    [commit],
  );

  const value = useMemo<PreferencesContextValue>(
    () => ({ ...prefs, setLanguage, setTheme, bindAccount }),
    [prefs, setLanguage, setTheme, bindAccount],
  );
  const i18n = useMemo(() => makeI18n(prefs.language), [prefs.language]);

  return (
    <PreferencesContext value={value}>
      <I18nContext value={i18n}>{children}</I18nContext>
    </PreferencesContext>
  );
}
