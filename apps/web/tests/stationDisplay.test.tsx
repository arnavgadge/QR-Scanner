// Desktop records show "Registered on Station 2 (Ravi) at 10:42, 11 Oct"; web records keep rows.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResultPanel } from '../src/features/operator/ResultPanel';
import { recordedBy } from '../src/features/stations/recordedBy';
import { I18nContext, makeI18n } from '../src/i18n';
import type { DuplicateSerialResult, NewSerialResult } from '../src/services/serial';
import type { Company } from '../src/types';

const company: Company = {
  id: 'a',
  name: 'Company A',
  codeType: 'barcode',
  serialFormat: '',
  active: true,
  createdAt: null,
  updatedAt: null,
  updatedByName: '',
};
// 10:42 on 11 Oct in the machine's local time zone (the screen shows local time).
const at1042 = new Date(2026, 9, 11, 10, 42).toISOString();
const at1043 = new Date(2026, 9, 11, 10, 43).toISOString();
const ref = { current: null };
const html = (el: React.ReactElement, lang: 'en' | 'hi' = 'en') =>
  renderToStaticMarkup(<I18nContext value={makeI18n(lang)}>{el}</I18nContext>).replace(
    /<[^>]+>/g,
    ' ',
  );

const dup = (
  prev: { nodeName?: string; scannedByName: string },
  now: { nodeName?: string; scannedByName: string },
): DuplicateSerialResult => ({
  result: 'duplicate',
  serial: '13WAA00101A26',
  company,
  existingRecord: {
    serial: '13WAA00101A26',
    partNo: '',
    company: 'Company A',
    companyId: 'a',
    source: 'manual',
    scannedAt: at1042,
    scannedBy: 'x',
    ...prev,
  },
  currentAttempt: { scannedBy: 'y', timestamp: at1043, ...now },
});

describe('station display', () => {
  it('duplicate screen: "Registered on Station 2 (Ravi) at 10:42, 11 Oct" and this attempt', () => {
    const out = html(
      <ResultPanel
        result={dup(
          { nodeName: 'Station 2', scannedByName: 'Ravi' },
          { nodeName: 'Station 3', scannedByName: '' },
        )}
        nextRef={ref}
        onNext={() => {}}
      />,
    );
    expect(out).toContain('Registered on Station 2 (Ravi) at 10:42, 11 Oct');
    expect(out).toContain('This attempt: Station 3 at 10:43, 11 Oct');
    expect(out).not.toContain('Registered by');
  });

  it('green screen: station and operator with the server time', () => {
    const result: NewSerialResult = {
      result: 'new',
      serial: '13WAA00101A27',
      company,
      partNo: '',
      source: 'manual',
      scannedBy: 'n1',
      scannedByName: '',
      scannedAt: at1042,
      nodeName: 'Station 2',
    };
    expect(html(<ResultPanel result={result} nextRef={ref} onNext={() => {}} />)).toContain(
      'Registered on Station 2 at 10:42, 11 Oct',
    );
  });

  it('records from before stations keep the operator name they were stored with', () => {
    const t = makeI18n('en').t;
    expect(recordedBy(t, 'Station A', 'Oli Operator')).toBe('Station A (Oli Operator)');
    expect(recordedBy(t, 'Station A', '')).toBe('Station A');
    expect(recordedBy(t, undefined, 'Oli Operator')).toBe('Oli Operator'); // web records
  });

  it('web records (no station) keep the "registered by / at" rows', () => {
    const out = html(
      <ResultPanel
        result={dup({ scannedByName: 'Oli' }, { scannedByName: 'Omar' })}
        nextRef={ref}
        onNext={() => {}}
      />,
    );
    expect(out).toContain('Registered by');
    expect(out).not.toContain('Registered on');
    // The web app has no reprint (its duplicate screen never offers a label).
    expect(out).not.toContain('Print label');
  });

  it('translated, with Western digits', () => {
    const out = html(
      <ResultPanel
        result={dup(
          { nodeName: 'Station 2', scannedByName: 'Ravi' },
          { nodeName: 'Station 3', scannedByName: '' },
        )}
        nextRef={ref}
        onNext={() => {}}
      />,
      'hi',
    );
    expect(out).toContain('Station 2 (Ravi)');
    expect(out).toContain('10:42');
    expect(out).not.toMatch(/[०-९]/);
  });
});
