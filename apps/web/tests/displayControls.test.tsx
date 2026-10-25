// The language dropdown and theme toggle (rendered to static markup; no DOM needed).
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DISPLAY_CONTROL_BOX,
  DisplayControls,
  LanguageSwitcher,
} from '../src/features/preferences/DisplayControls';
import {
  PreferencesContext,
  type PreferencesContextValue,
} from '../src/features/preferences/PreferencesContext';
import { I18nContext, makeI18n } from '../src/i18n';
import type { Language } from '../src/types';

const render = (language: Language, el: React.ReactElement) => {
  const prefs: PreferencesContextValue = {
    language,
    theme: 'dark',
    setLanguage: () => {},
    setTheme: () => {},
    bindAccount: () => {},
  };
  return renderToStaticMarkup(
    <PreferencesContext value={prefs}>
      <I18nContext value={makeI18n(language)}>{el}</I18nContext>
    </PreferencesContext>,
  );
};

const selectTag = (html: string) => /<select[^>]*>/.exec(html)?.[0] ?? '';
const classOf = (tag: string) => /class="([^"]*)"/.exec(tag)?.[1]?.split(/\s+/) ?? [];

describe('language dropdown', () => {
  it('is a native select listing each language in its own script, current one selected', () => {
    const html = render('mr', <LanguageSwitcher />);
    expect(selectTag(html)).toContain('data-testid="language-select"');
    expect(html).toContain('<option value="en" lang="en">English</option>');
    expect(html).toContain('<option value="hi" lang="hi">हिन्दी</option>');
    expect(html).toMatch(/<option value="mr" lang="mr" selected="">मराठी<\/option>/);
    // the old segmented buttons are gone
    expect(html).not.toContain('<button');
  });

  it('has a "Language" label, translated, tied to the select', () => {
    for (const [lang, label] of [
      ['en', 'Language'],
      ['hi', 'भाषा'],
      ['mr', 'भाषा'],
    ] as const) {
      const html = render(lang, <LanguageSwitcher />);
      const id = /<select[^>]* id="([^"]+)"/.exec(html)?.[1];
      expect(id).toBeTruthy();
      expect(html).toContain(`<label for="${id}" class="sr-only">${label}</label>`);
    }
  });

  it('never gets a fixed or full width (a native select fits its longest option)', () => {
    const classes = classOf(selectTag(render('hi', <LanguageSwitcher />)));
    expect(classes.filter((c) => /^(w-|max-w-|truncate$|overflow-hidden$)/.test(c))).toEqual([]);
  });

  it('shares the theme toggle box: same height, border and background', () => {
    const html = render('en', <DisplayControls />);
    const select = classOf(selectTag(html));
    const toggle = classOf(/<button[^>]*data-testid="theme-toggle"[^>]*>/.exec(html)?.[0] ?? '');
    for (const c of DISPLAY_CONTROL_BOX.split(' ')) {
      expect(select, c).toContain(c);
      expect(toggle, c).toContain(c);
    }
    expect(DISPLAY_CONTROL_BOX).toMatch(/\bh-touch\b/);
  });

  it('the open list follows the theme: color-scheme is dark under the dark theme', () => {
    const css = readFileSync('src/styles/index.css', 'utf8');
    const dark = css.slice(css.indexOf(':root.dark'), css.indexOf('}', css.indexOf(':root.dark')));
    expect(dark).toMatch(/color-scheme:\s*dark/);
    expect(css).toMatch(/html\s*\{[^}]*color-scheme:\s*light/);
    expect(css).toMatch(/option\s*\{[^}]*var\(--color-surface\)/);
  });
});
