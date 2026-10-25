import { useId, useRef } from 'react';
import { flushSync } from 'react-dom';
import { isLanguage, LANGUAGE_NAMES, LANGUAGES } from '../../i18n';
import { useI18n } from '../../hooks/useI18n';
import { usePreferences } from '../../hooks/usePreferences';
import { focusSerialInput } from './dom';
import { revealThemeChange } from './themeTransition';

/**
 * Shared box for the two display controls, so the language dropdown and the theme button are
 * exactly the same height with the same border and sit cleanly side by side.
 */
export const DISPLAY_CONTROL_BOX = 'h-touch rounded-md border border-line bg-surface text-ink';

/**
 * Language choice: a native dropdown (keyboard and screen-reader support for free). Each language
 * is written in its own script (English, हिन्दी, मराठी) so a person can always find theirs,
 * whatever language is currently shown. No width is set: a native select sizes itself to its
 * longest option, so Devanagari names are never clipped, closed or open.
 */
export function LanguageSwitcher() {
  const { language, setLanguage } = usePreferences();
  const { t } = useI18n();
  const id = useId();
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {t('prefs.language')}
      </label>
      <select
        id={id}
        value={language}
        lang={language}
        data-testid="language-select"
        onChange={(e) => {
          if (!isLanguage(e.target.value)) return;
          setLanguage(e.target.value);
          focusSerialInput();
        }}
        className={`${DISPLAY_CONTROL_BOX} cursor-pointer px-2 text-sm leading-normal font-semibold hover:bg-action-soft`}
      >
        {LANGUAGES.map((code) => (
          <option key={code} value={code} lang={code}>
            {LANGUAGE_NAMES[code]}
          </option>
        ))}
      </select>
    </>
  );
}

/** Light/dark switch. The new theme spreads as a circle from this button (see themeTransition). */
export function ThemeToggle() {
  const { theme, setTheme } = usePreferences();
  const { t } = useI18n();
  const ref = useRef<HTMLButtonElement>(null);
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = t(next === 'dark' ? 'prefs.toDark' : 'prefs.toLight');

  const toggle = () => {
    revealThemeChange(ref.current, () => {
      // Synchronous, so the transition's "after" snapshot already shows the new theme and icon.
      flushSync(() => setTheme(next));
      // Keep the operator's keyboard flow: back to the serial field if there is one.
      focusSerialInput();
    });
  };

  return (
    <button
      ref={ref}
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      data-theme-current={theme}
      className={`${DISPLAY_CONTROL_BOX} inline-flex min-w-touch items-center justify-center hover:bg-action-soft`}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/** Both display controls, for page headers. */
export function DisplayControls() {
  return (
    <div className="flex items-center gap-2">
      <LanguageSwitcher />
      <ThemeToggle />
    </div>
  );
}

const iconProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

function MoonIcon() {
  return (
    <svg {...iconProps}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
