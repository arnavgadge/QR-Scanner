import { createContext } from 'react';
import type { Language, Theme, UserPreferences } from '../../types';

export interface PreferencesContextValue {
  language: Language;
  theme: Theme;
  setLanguage: (language: Language) => void;
  setTheme: (theme: Theme) => void;
  /**
   * Links the preferences to the signed-in account (null = signed out). The account's saved
   * choices, if any, are applied once per sign-in; later changes are saved to the account.
   */
  bindAccount: (uid: string | null, saved?: UserPreferences) => void;
}

export const PreferencesContext = createContext<PreferencesContextValue | null>(null);
