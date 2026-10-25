// Multilingual UI (en / hi / mr) and dark mode: dictionaries, formatting, input screening,
// rendering, print safety and the theme-switch fallbacks. Pure tests (no emulator needed).
import { readFileSync } from 'node:fs';
import { Timestamp } from 'firebase/firestore';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screenSerialInput } from '../src/features/operator/serialInput';
import { ResultPanel } from '../src/features/operator/ResultPanel';
import { revealThemeChange } from '../src/features/preferences/themeTransition';
import { readStoredPreferences } from '../src/features/preferences/storage';
import { LabelPreview } from '../src/features/printing';
import {
  formatDateTimeIn,
  formatNumber,
  I18nContext,
  LOCALES,
  makeI18n,
  msg,
  translate,
} from '../src/i18n';
import { en } from '../src/i18n/locales/en';
import { hi } from '../src/i18n/locales/hi';
import { mr } from '../src/i18n/locales/mr';
import { AppError, errorText } from '../src/services/errors';
import { parseUser } from '../src/services/firebase/converters';
import type { DuplicateSerialResult, NewSerialResult } from '../src/services/serial';
import type { Company, Language } from '../src/types';

const DEVANAGARI_DIGIT = /[०-९]/;
const DEVANAGARI = /[ऀ-ॿ]/;
const keys = Object.keys(en) as (keyof typeof en)[];
/** Parameter names in a template, including plural selectors ({count, plural, ...}). */
const params = (s: string) => new Set([...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]));

describe('dictionaries', () => {
  it.each([
    ['hi', hi],
    ['mr', mr],
  ] as const)('%s translates every English key, with no unknown or blank entries', (_, dict) => {
    expect(keys.filter((k) => !dict[k])).toEqual([]);
    expect(Object.keys(dict).filter((k) => !(k in en))).toEqual([]);
  });

  it.each([
    ['hi', hi],
    ['mr', mr],
  ] as const)('%s keeps exactly the same parameters as English', (_, dict) => {
    for (const k of keys) {
      expect([...params(dict[k] ?? '')].sort(), k).toEqual([...params(en[k])].sort());
    }
  });

  it('Hindi and Marathi text is really in Devanagari (not English copied over)', () => {
    for (const k of [
      'scan.title',
      'result.duplicateTitle',
      'result.newTitle',
      'nav.scan',
    ] as const) {
      expect(hi[k]).toMatch(DEVANAGARI);
      expect(mr[k]).toMatch(DEVANAGARI);
    }
  });

  it('a missing translation falls back to English, never to blank', () => {
    const saved = hi['scan.check'];
    const dict = hi as Record<string, string | undefined>;
    try {
      delete dict['scan.check'];
      expect(translate('hi', msg('scan.check'))).toBe(en['scan.check']);
      dict['scan.check'] = '';
      expect(translate('hi', msg('scan.check'))).toBe(en['scan.check']);
    } finally {
      dict['scan.check'] = saved;
    }
  });
});

describe('formatting', () => {
  it('numbers and dates use Western digits in every language', () => {
    const when = '2026-10-04T10:05:09.000Z';
    for (const lang of ['en', 'hi', 'mr'] as Language[]) {
      expect(formatNumber(1234567, lang)).toMatch(/^[\d,]+$/);
      const date = formatDateTimeIn(when, LOCALES[lang]);
      expect(date, lang).not.toMatch(DEVANAGARI_DIGIT);
      expect(date, lang).toMatch(/\d/);
      expect(translate(lang, msg('import.importing', { done: 1500, total: 2000 }))).not.toMatch(
        DEVANAGARI_DIGIT,
      );
    }
    // Why the -u-nu-latn extension matters: plain Marathi formatting uses Devanagari digits.
    expect(new Intl.NumberFormat('mr-IN').format(123)).toMatch(DEVANAGARI_DIGIT);
  });

  it('plurals pick the right form and show the count', () => {
    expect(translate('en', msg('export.readyDetail', { filename: 'f.xlsx', count: 1 }))).toBe(
      'f.xlsx — 1 serial record',
    );
    expect(translate('en', msg('export.readyDetail', { filename: 'f.xlsx', count: 1200 }))).toBe(
      'f.xlsx — 1,200 serial records',
    );
    expect(translate('en', msg('print.requested', { count: 1 }))).toMatch(
      /^Print dialog requested\. /,
    );
    expect(translate('en', msg('print.requested', { count: 3 }))).toMatch(
      /requested \(3 times\)\./,
    );
  });

  it('serials, part numbers and company names pass through untouched', () => {
    for (const lang of ['hi', 'mr'] as Language[]) {
      expect(translate(lang, msg('ocrResult.use', { serial: '13WAA000000123' }))).toContain(
        '13WAA000000123',
      );
      expect(
        translate(
          lang,
          msg('verify.invalidFormat', {
            company: 'Company A',
            format: msg('serial.formatPattern', { format: '13WAA#########' }),
          }),
        ),
      ).toContain('13WAA#########');
    }
  });

  it('service messages keep their English text and carry a translatable form', () => {
    const e = new AppError('network', msg('errors.network'));
    expect(e.message).toBe('Unable to connect to the database. Please try again.');
    expect(translate('mr', errorText(e))).toBe(mr['errors.network']);
    // A plain-string error (no translation known) is still shown, unchanged.
    expect(errorText(new AppError('unknown', 'legacy text'))).toBe('legacy text');
  });
});

describe('serial input accepts only A-Z and 0-9', () => {
  it('upper-cases letters and drops whitespace from a paste', () => {
    expect(screenSerialInput(' 13waa000000123 \n')).toEqual({
      accepted: true,
      value: '13WAA000000123',
    });
  });

  it('refuses Devanagari letters and digits with the keyboard-language reason', () => {
    for (const typed of ['अ', '13WAA१२३', 'सीरियल', '१']) {
      expect(screenSerialInput(typed)).toEqual({ accepted: false, problem: 'non-ascii' });
    }
  });

  it('refuses other characters', () => {
    for (const typed of ['13-WAA', 'A/B', 'A.B', 'É1']) {
      expect(screenSerialInput(typed).accepted).toBe(false);
    }
    expect(screenSerialInput('13-WAA')).toEqual({ accepted: false, problem: 'invalid-char' });
  });

  it('the refusal message tells the operator to switch the keyboard to English', () => {
    expect(en['serialInput.nonAscii']).toMatch(/keyboard to English/);
    expect(hi['serialInput.nonAscii']).toMatch(/English/);
    expect(mr['serialInput.nonAscii']).toMatch(/English/);
  });
});

const company = (codeType: Company['codeType']): Company => ({
  id: 'company-a',
  name: 'Company A',
  codeType,
  serialFormat: '13WAA#########',
  active: true,
  createdAt: null,
  updatedAt: null,
  updatedByName: '',
});

const inLanguage = (lang: Language, el: React.ReactElement) =>
  renderToStaticMarkup(<I18nContext value={makeI18n(lang)}>{el}</I18nContext>);

describe('rendered screens', () => {
  const duplicate: DuplicateSerialResult = {
    result: 'duplicate',
    serial: '13WAA000000123',
    company: company('barcode'),
    existingRecord: {
      serial: '13WAA000000123',
      partNo: 'PN-7',
      company: 'Company A',
      companyId: 'company-a',
      source: 'manual',
      scannedAt: '2026-10-04T10:00:00.000Z',
      scannedBy: 'u1',
      scannedByName: 'Oli',
    },
    currentAttempt: {
      scannedBy: 'u2',
      scannedByName: 'Omar',
      timestamp: '2026-10-05T08:00:00.000Z',
    },
  };
  const ref = { current: null };

  it('switching language changes the text but never the serial, part number or digits', () => {
    const english = inLanguage(
      'en',
      <ResultPanel result={duplicate} nextRef={ref} onNext={() => {}} />,
    );
    expect(english).toContain('Duplicate Serial');
    for (const [lang, dict] of [
      ['hi', hi],
      ['mr', mr],
    ] as const) {
      const out = inLanguage(
        lang,
        <ResultPanel result={duplicate} nextRef={ref} onNext={() => {}} />,
      );
      expect(out).toContain(dict['result.duplicateTitle']);
      expect(out).toContain(dict['result.reengrave']);
      expect(out).not.toContain('Duplicate Serial');
      expect(out).toContain('13WAA000000123');
      expect(out).toContain('PN-7');
      expect(out).not.toMatch(DEVANAGARI_DIGIT);
    }
  });

  it('the printed label is never translated (Part No:, serial, Western-digit time)', () => {
    const result: NewSerialResult = {
      result: 'new',
      serial: '13WAA000000124',
      company: company('qr'),
      partNo: 'PN-8',
      source: 'manual',
      scannedBy: 'u1',
      scannedByName: 'Oli',
      scannedAt: '2026-10-04T10:00:00.000Z',
    };
    const out = inLanguage('mr', <LabelPreview result={result} />);
    const label = out.slice(out.indexOf('data-testid="label"'));
    expect(label).toContain('Part No:');
    expect(label).toContain('13WAA000000124');
    const time = /data-testid="label-time"[^>]*>([^<]*)</.exec(label)?.[1] ?? '';
    expect(time).toMatch(/\d/);
    expect(time).not.toMatch(DEVANAGARI);
    // ...while the screen around it is in Marathi.
    expect(out).toContain(mr['labelPreview.ready']);
  });
});

describe('dark mode', () => {
  const css = readFileSync('src/styles/index.css', 'utf8');

  it('the dark theme only exists on screen, so printing always uses the light colors', () => {
    const screenBlock = css.slice(css.indexOf('@media screen'));
    expect(css.indexOf(':root.dark')).toBeGreaterThan(css.indexOf('@media screen'));
    expect(screenBlock).toContain(':root.dark');
    expect(css).not.toMatch(/@media print/);
    expect(readFileSync('src/styles/print.css', 'utf8')).not.toMatch(/dark/);
  });

  it('every color token the light theme defines is redefined for dark', () => {
    const tokens = (block: string) => [...block.matchAll(/(--color-[\w-]+):/g)].map((m) => m[1]);
    const light = tokens(css.slice(css.indexOf('@theme'), css.indexOf('--font-sans')));
    const dark = tokens(css.slice(css.indexOf(':root.dark')));
    expect(dark.sort()).toEqual(light.sort());
  });

  it('the Devanagari font is bundled locally (no CDN) and limited to Devanagari', () => {
    expect(css).toMatch(/src: url\('\.\.\/assets\/fonts\/NotoSansDevanagari-wght\.woff2'\)/);
    expect(css).toMatch(/unicode-range:\s*U\+0900-097F/);
    expect(css).not.toMatch(/https?:\/\//);
    expect(readFileSync('index.html', 'utf8')).not.toMatch(
      /fonts\.googleapis|https?:\/\/(?!www\.w3)/,
    );
  });
});

describe('theme switch animation', () => {
  afterEach(() => vi.unstubAllGlobals());

  const button = {
    getBoundingClientRect: () => ({ left: 100, top: 20, width: 40, height: 40 }),
  } as unknown as HTMLElement;
  const stubDom = (opts: { reduce: boolean; supported: boolean }) => {
    const animate = vi.fn();
    const start = vi.fn((update: () => void) => {
      update();
      return { ready: Promise.resolve() };
    });
    vi.stubGlobal('window', {
      innerWidth: 1000,
      innerHeight: 800,
      matchMedia: (q: string) => ({ matches: opts.reduce && q.includes('reduce') }),
    });
    vi.stubGlobal('document', {
      documentElement: { animate },
      ...(opts.supported ? { startViewTransition: start } : {}),
    });
    return { animate, start };
  };

  it('grows a circle from the button centre until it covers the window', async () => {
    const { animate, start } = stubDom({ reduce: false, supported: true });
    const update = vi.fn();
    revealThemeChange(button, update);
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    const [keyframes, options] = animate.mock.calls[0]!;
    const radius = Math.hypot(1000 - 120, 800 - 40);
    expect(keyframes.clipPath).toEqual([
      'circle(0px at 120px 40px)',
      `circle(${radius}px at 120px 40px)`,
    ]);
    expect(options.pseudoElement).toBe('::view-transition-new(root)');
  });

  it('switches instantly when reduced motion is requested', () => {
    const { start } = stubDom({ reduce: true, supported: true });
    const update = vi.fn();
    revealThemeChange(button, update);
    expect(start).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('switches instantly where View Transitions are not supported', () => {
    stubDom({ reduce: false, supported: false });
    const update = vi.fn();
    revealThemeChange(button, update);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('preference persistence', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to English + light when storage is unavailable or holds junk', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('SecurityError');
        },
      },
    });
    expect(readStoredPreferences()).toEqual({ language: 'en', theme: 'light' });
    vi.stubGlobal('window', {
      localStorage: { getItem: () => '{"language":"fr","theme":"neon"}' },
    });
    expect(readStoredPreferences()).toEqual({ language: 'en', theme: 'light' });
    vi.stubGlobal('window', {
      localStorage: { getItem: () => '{"language":"mr","theme":"dark"}' },
    });
    expect(readStoredPreferences()).toEqual({ language: 'mr', theme: 'dark' });
  });

  it('account preferences are read leniently: unknown values never block sign-in', () => {
    const base = {
      name: 'Oli',
      email: 'oli@example.test',
      role: 'operator',
      active: true,
      created_at: Timestamp.now(),
    };
    expect(parseUser('u1', base).preferences).toEqual({});
    expect(
      parseUser('u1', { ...base, preferences: { language: 'hi', theme: 'dark' } }).preferences,
    ).toEqual({
      language: 'hi',
      theme: 'dark',
    });
    expect(
      parseUser('u1', { ...base, preferences: { language: 'xx', theme: 7 } }).preferences,
    ).toEqual({});
  });
});
