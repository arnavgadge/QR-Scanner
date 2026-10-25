import { useContext } from 'react';
import { I18nContext, type I18n } from '../i18n';

/** Translations and number/date formatting in the viewer's language. */
export function useI18n(): I18n {
  return useContext(I18nContext);
}
