import { createContext, createElement, Fragment, type ReactNode } from 'react';
import type { Language } from '../types';
import {
  formatDateTimeIn,
  formatShortDateTimeIn,
  formatNumber,
  formatParts,
  LOCALES,
  template,
  translate,
  type MessageKey,
  type MsgParams,
  type Text,
} from './core';

/** What components use to show text. Obtain it with `useI18n()`. */
export interface I18n {
  language: Language;
  /** Intl locale (always Western digits). */
  locale: string;
  t: (key: MessageKey, params?: MsgParams) => string;
  /** Renders a service message (`Msg`) or passes a plain string through unchanged. */
  text: (text: Text) => string;
  /** Like `t`, but the placeholders named in `nodes` are replaced by React nodes (bold, code…). */
  rich: (
    key: MessageKey,
    nodes: Readonly<Record<string, ReactNode>>,
    params?: MsgParams,
  ) => ReactNode;
  number: (value: number) => string;
  dateTime: (iso: string | null) => string;
  /** Compact "10:42, 11 Oct". */
  shortDateTime: (iso: string | null) => string;
}

export function makeI18n(language: Language): I18n {
  const locale = LOCALES[language];
  return {
    language,
    locale,
    t: (key, params) => translate(language, { key, ...(params ? { params } : {}) }),
    text: (text) => translate(language, text),
    rich: (key, nodes, params) =>
      createElement(
        Fragment,
        null,
        ...formatParts<ReactNode>(language, template(language, key), params, nodes).map((p, i) =>
          createElement(Fragment, { key: i }, p),
        ),
      ),
    number: (value) => formatNumber(value, language),
    dateTime: (iso) => formatDateTimeIn(iso, locale),
    shortDateTime: (iso) => formatShortDateTimeIn(iso, locale),
  };
}

/** English by default, so components also render outside the provider (e.g. in tests). */
export const I18nContext = createContext<I18n>(makeI18n('en'));
