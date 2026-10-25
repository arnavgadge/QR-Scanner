// Item 8, find and print any serial: reprint on the red duplicate screen (desktop only), labels of
// imported serials use the normal layout, import history rows open their details.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/data', () => ({
  dataService: {
    capabilities: {
      companyLabelSize: true,
      manageAccounts: true,
      stations: true,
      stationScanning: true,
      serialLookup: true,
    },
  },
}));

import { ImportHistoryList } from '../src/features/admin/ImportHistoryList';
import { AuthContext, type AuthContextValue } from '../src/features/auth/AuthContext';
import { ResultPanel } from '../src/features/operator/ResultPanel';
import { reprintLabelData } from '../src/features/reprint/reprintLabelData';
import { I18nContext, makeI18n } from '../src/i18n';
import { buildLabelData } from '../src/services/printing';
import type { DuplicateSerialResult } from '../src/services/serial';
import type { Company, SerialRecord } from '../src/types';

const company: Company = {
  id: 'a',
  name: 'Company A',
  codeType: 'qr',
  serialFormat: '',
  active: true,
  createdAt: null,
  updatedAt: null,
  updatedByName: '',
  labelSize: { widthMm: 50, heightMm: 25 },
};
const record = (over: Partial<SerialRecord> = {}): SerialRecord => ({
  serial: '13WAA00101A26',
  partNo: 'P-7',
  company: 'Company A',
  companyId: 'a',
  source: 'manual',
  scannedAt: '2026-10-11T05:12:00.000Z',
  scannedBy: 'n2',
  scannedByName: 'Ravi',
  nodeName: 'Station 2',
  ...over,
});

const signedOut: AuthContextValue = {
  status: 'unauthenticated',
  signIn: async () => undefined,
  signOut: async () => undefined,
  retry: () => undefined,
};
const html = (el: React.ReactElement, lang: 'en' | 'mr' = 'en') =>
  renderToStaticMarkup(
    <I18nContext value={makeI18n(lang)}>
      <AuthContext value={signedOut}>{el}</AuthContext>
    </I18nContext>,
  );

describe('reprint', () => {
  it('the red duplicate screen offers "Print label" (administrators only) on the desktop', () => {
    const dup: DuplicateSerialResult = {
      result: 'duplicate',
      serial: '13WAA00101A26',
      company,
      existingRecord: record(),
      currentAttempt: {
        scannedBy: 'n3',
        scannedByName: '',
        timestamp: null,
        nodeName: 'Station 3',
      },
    };
    const out = html(<ResultPanel result={dup} nextRef={{ current: null }} onNext={() => {}} />);
    expect(out).toContain('data-testid="duplicate-reprint"');
    expect(out).toContain('Print label');
    expect(out).toContain('An administrator can print it again');
    // Nothing is printed by just showing the screen.
    expect(out).not.toContain('label-print-root');
    expect(
      html(<ResultPanel result={dup} nextRef={{ current: null }} onNext={() => {}} />, 'mr'),
    ).toContain('लेबल प्रिंट करा');
  });

  it('an imported serial gets the normal label: same code, type and size as at registration', () => {
    const atRegistration = buildLabelData({
      result: 'new',
      serial: '13WAA00101A26',
      company,
      partNo: 'P-7',
      source: 'manual',
      scannedBy: 'n2',
      scannedByName: 'Ravi',
      scannedAt: '2026-10-11T05:12:00.000Z',
    });
    const fromStation = reprintLabelData({ record: record(), company });
    const imported = reprintLabelData({
      record: record({ source: 'excel', importFile: 'parts.xlsx', scannedByName: 'Ada Admin' }),
      company,
    });
    expect(atRegistration.ok && fromStation).toEqual(atRegistration.ok && atRegistration.label);
    expect(imported).toMatchObject({
      serial: '13WAA00101A26',
      partNo: 'P-7',
      codeType: 'qr',
      sizeMm: { width: 50, height: 25 },
    });
    expect(imported!.codeValue).toBe(atRegistration.ok && atRegistration.label.codeValue);
    // No company (deleted) or no code type: nothing to print.
    expect(reprintLabelData({ record: record(), company: null })).toBeNull();
    expect(
      reprintLabelData({ record: record(), company: { ...company, codeType: null } }),
    ).toBeNull();
  });
});

describe('import history', () => {
  it('each import opens its details (added, skipped, conflicts)', () => {
    const out = html(
      <ImportHistoryList
        onRetry={() => {}}
        state={{
          status: 'ready',
          entries: [
            {
              id: '7',
              filename: 'parts.xlsx',
              importedBy: 'u',
              importedByName: 'Ada Admin',
              importedAt: '2026-10-11T05:12:00.000Z',
              totalRows: 3,
              newCount: 1,
              skipped: 1,
              conflicts: 1,
              duplicates: 0,
              invalid: 0,
              status: 'completed',
              error: '',
            },
          ],
        }}
      />,
    );
    expect(out).toMatch(/<button[^>]*aria-expanded="false"[^>]*>parts\.xlsx<\/button>/);
  });
});
