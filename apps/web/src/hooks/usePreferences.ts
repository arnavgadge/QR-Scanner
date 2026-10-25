import { useContext } from 'react';
import {
  PreferencesContext,
  type PreferencesContextValue,
} from '../features/preferences/PreferencesContext';

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return ctx;
}
