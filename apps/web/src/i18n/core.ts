/**
 * Translation core: pure functions, no React, no Firebase, no network. Services may import it to
 * describe a user-facing message as a `Msg` (key + params) that the UI translates at display time.
 *
 * Template syntax (a small ICU subset):
 *   {name}                                   a parameter
 *   {count, plural, one {# row} other {# rows}}   plural branches; `#` is the formatted count
 * Numbers are always formatted with Western (Latin) digits, in every language.
 */
import type { Language } from '../types';
import { en, type MessageKey } from './locales/en';
import { hi } from './locales/hi';
import { mr } from './locales/mr';

export type { MessageKey };
export type Dictionary = { readonly [K in MessageKey]?: string };

export type MsgParam = string | number | Msg | readonly MsgParam[];
export type MsgParams = Readonly<Record<string, MsgParam>>;

/** A translatable message: rendered in the viewer's language at display time. */
export interface Msg {
  readonly key: MessageKey;
  readonly params?: MsgParams;
}

/**
 * Something to show the user: a translatable `Msg`, or a plain string that is shown as-is. Plain
 * strings are for text that must never be translated (user data such as names and file names,
 * stored history text) and for legacy errors that only carry English.
 */
export type Text = Msg | string;

export const LANGUAGES: readonly Language[] = ['en', 'hi', 'mr'];
export const DEFAULT_LANGUAGE: Language = 'en';

/** Each language's name in its own script (never translated, so anyone can find their own). */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  en: 'English',
  hi: 'हिन्दी',
  mr: 'मराठी',
};

const DICTIONARIES: Readonly<Record<Language, Dictionary>> = { en, hi, mr };

/**
 * Intl locale per language. `-u-nu-latn` forces Western digits: Marathi otherwise defaults to
 * Devanagari digits (०१२…), which operators must never see in serials, counts or times.
 */
export const LOCALES: Readonly<Record<Language, string>> = {
  en: 'en-IN',
  hi: 'hi-IN-u-nu-latn',
  mr: 'mr-IN-u-nu-latn',
};

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v);
}

export function msg(key: MessageKey, params?: MsgParams): Msg {
  return params ? { key, params } : { key };
}

export function isMsg(v: unknown): v is Msg {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'key' in v;
}

/** The template for `key` in `lang`; falls back to English, never to a blank string. */
export function template(lang: Language, key: MessageKey): string {
  const own = DICTIONARIES[lang][key];
  return own ? own : (en[key] ?? key);
}

const numberFormats = new Map<string, Intl.NumberFormat>();
export function formatNumber(value: number, lang: Language = DEFAULT_LANGUAGE): string {
  const locale = LOCALES[lang];
  let f = numberFormats.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale);
    numberFormats.set(locale, f);
  }
  return f.format(value);
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
/** Date + time in `locale`, Western digits. '—' for a missing or invalid timestamp. */
export function formatDateTimeIn(iso: string | null, locale: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  let f = dateFormats.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' });
    dateFormats.set(locale, f);
  }
  return f.format(d);
}

const shortFormats = new Map<string, [Intl.DateTimeFormat, Intl.DateTimeFormat]>();
/** Compact "10:42, 11 Oct" (24-hour time, day and short month; Western digits). */
export function formatShortDateTimeIn(iso: string | null, locale: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  let f = shortFormats.get(locale);
  if (!f) {
    f = [
      new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
      new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }),
    ];
    shortFormats.set(locale, f);
  }
  return `${f[0].format(d)}, ${f[1].format(d)}`;
}

/** Interpolated pieces: strings plus raw parameter values (which may be rich, e.g. React nodes). */
export type Part<R> = string | R;

/**
 * Formats `tpl` into parts. Parameters found in `rich` are emitted as-is (for React nodes);
 * everything else is rendered to text in `lang`.
 */
export function formatParts<R>(
  lang: Language,
  tpl: string,
  params: MsgParams | undefined,
  rich?: Readonly<Record<string, R>>,
): Part<R>[] {
  const out: Part<R>[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push(text);
    text = '';
  };
  let i = 0;
  while (i < tpl.length) {
    const ch = tpl.charAt(i);
    if (ch !== '{') {
      text += ch;
      i++;
      continue;
    }
    const close = matchingBrace(tpl, i);
    if (close < 0) {
      text += tpl.slice(i); // unbalanced: show literally rather than lose text
      break;
    }
    const body = tpl.slice(i + 1, close);
    i = close + 1;
    const comma = body.indexOf(',');
    const name = (comma < 0 ? body : body.slice(0, comma)).trim();
    if (comma >= 0) {
      const rest = body.slice(comma + 1).trimStart();
      if (rest.startsWith('plural,')) {
        text += plural(lang, rest.slice('plural,'.length), params, name);
        continue;
      }
    }
    if (rich && name in rich) {
      flush();
      out.push(rich[name] as R);
      continue;
    }
    const value = params?.[name];
    text += value === undefined ? `{${name}}` : renderParam(lang, value);
  }
  flush();
  return out;
}

function matchingBrace(s: string, open: number): number {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    if (s.charAt(j) === '{') depth++;
    else if (s.charAt(j) === '}' && --depth === 0) return j;
  }
  return -1;
}

const pluralRules = new Map<Language, Intl.PluralRules>();
function plural(
  lang: Language,
  branches: string,
  params: MsgParams | undefined,
  name: string,
): string {
  const value = params?.[name];
  const count = typeof value === 'number' ? value : Number(value);
  let rules = pluralRules.get(lang);
  if (!rules) {
    rules = new Intl.PluralRules(LOCALES[lang]);
    pluralRules.set(lang, rules);
  }
  const options = new Map<string, string>();
  let i = 0;
  while (i < branches.length) {
    const open = branches.indexOf('{', i);
    if (open < 0) break;
    const selector = branches.slice(i, open).trim();
    const close = matchingBrace(branches, open);
    if (close < 0) break;
    options.set(selector, branches.slice(open + 1, close));
    i = close + 1;
  }
  const chosen =
    options.get(`=${count}`) ?? options.get(rules.select(count)) ?? options.get('other') ?? '';
  const shown = formatNumber(count, lang);
  return formatParts<never>(lang, chosen.replace(/#/g, shown), params).join('');
}

function renderParam(lang: Language, value: MsgParam): string {
  if (typeof value === 'number') return formatNumber(value, lang);
  if (typeof value === 'string') return value;
  if (isMsg(value)) return translate(lang, value);
  return (value as readonly MsgParam[]).map((v) => renderParam(lang, v)).join(' ');
}

/** Renders a message (or passes a plain string through) in `lang`. */
export function translate(lang: Language, text: Text): string {
  if (typeof text === 'string') return text;
  return formatParts<never>(lang, template(lang, text.key), text.params).join('');
}

/** English rendering, for logs and for the stable English `message` fields services expose. */
export function enText(text: Text): string {
  return translate('en', text);
}
