import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildExportDataset, type ExportSerial } from '../src/services/excel/exportDataset';
import {
  buildWorkbook,
  DATE_FORMAT,
  SERIAL_HEADERS,
  SERIAL_SHEET,
  SUMMARY_SHEET,
} from '../src/services/excel/exportWorkbook';
import { exportFilename } from '../src/services/excel/exportService';
import type { Company } from '../src/types';

const co = (id: string, name: string, codeType: 'barcode' | 'qr'): Company => ({
  id,
  name,
  codeType,
  serialFormat: '',
  active: true,
  createdAt: null,
  updatedAt: null,
});
const COMPANIES = [co('company-b', 'Company B', 'qr'), co('company-a', 'Company A', 'barcode')];

const ser = (
  serial: string,
  companyId: string,
  source: string,
  at: string | null,
  by = 'Oli',
): ExportSerial => ({
  serial,
  partNo: '',
  company: companyId === 'company-a' ? 'Company A' : 'Company B',
  companyId,
  source,
  scannedAt: at ? new Date(at) : null,
  scannedByName: by,
  incomplete: false,
});

const EXPORTED_AT = new Date('2026-10-03T08:09:10Z');

async function roundTrip(serials: ExportSerial[], companies = COMPANIES) {
  const dataset = buildExportDataset({
    serials,
    companies,
    exportedAt: EXPORTED_AT,
    exportedBy: 'Ada Admin',
  });
  const buf = await buildWorkbook(dataset);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return { dataset, wb };
}

describe('buildExportDataset', () => {
  it('resolves company names / code types and sorts by company then serial (deterministic)', () => {
    const { rows, summary } = buildExportDataset({
      serials: [
        ser('B-2', 'company-b', 'manual', '2026-01-02T00:00:00Z'),
        ser('A-10', 'company-a', 'excel', '2026-01-01T00:00:00Z'),
        ser('A-02', 'company-a', 'excel', '2026-01-01T00:00:00Z'),
        ser('B-1', 'company-b', 'excel', '2026-01-01T00:00:00Z'),
      ],
      companies: COMPANIES,
      exportedAt: EXPORTED_AT,
      exportedBy: 'Ada',
    });
    expect(rows.map((r) => r.serial)).toEqual(['A-02', 'A-10', 'B-1', 'B-2']);
    expect(rows[0]).toMatchObject({ company: 'Company A', codeType: 'BARCODE' });
    expect(rows[2]).toMatchObject({ company: 'Company B', codeType: 'QR' });
    expect(summary.total).toBe(4);
    expect(summary.bySource).toEqual([
      { label: 'excel', count: 3 },
      { label: 'manual', count: 1 },
    ]);
    expect(summary.byCompany.map((c) => [c.company, c.count])).toEqual([
      ['Company A', 2],
      ['Company B', 2],
    ]);
    expect(summary.earliest?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(summary.latest?.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('keeps the stored name and marks UNKNOWN when the company record is missing', () => {
    const { rows, summary } = buildExportDataset({
      serials: [ser('X-1', 'gone', 'scan', null)],
      companies: COMPANIES,
      exportedAt: EXPORTED_AT,
      exportedBy: 'Ada',
    });
    expect(rows[0]).toMatchObject({ codeType: 'UNKNOWN', source: 'scan', registeredAt: null });
    expect(summary.unresolvedCompany).toBe(1);
  });
});

describe('workbook', () => {
  it('has the expected sheets, headers, filter and frozen header', async () => {
    const { wb } = await roundTrip([ser('A-1', 'company-a', 'excel', '2026-01-01T10:00:00Z')]);
    expect(wb.worksheets.map((w) => w.name)).toEqual([SERIAL_SHEET, SUMMARY_SHEET]);
    const ws = wb.getWorksheet(SERIAL_SHEET)!;
    expect((ws.getRow(1).values as string[]).slice(1)).toEqual([...SERIAL_HEADERS]);
    expect(ws.getRow(1).font?.bold).toBe(true);
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
  });

  it('keeps serials as TEXT: leading zeros, long numeric, scientific-looking, formula-looking', async () => {
    const tricky = [
      '00012345',
      '123456789012345678901234567890',
      '1E5',
      '0001E10',
      '=SUM(1,2)',
      '+49123',
      '000000000000',
      '13WAA000000001',
    ];
    const { wb } = await roundTrip(
      tricky.map((s) => ser(s, 'company-a', 'excel', '2026-01-01T00:00:00Z')),
    );
    const ws = wb.getWorksheet(SERIAL_SHEET)!;
    const out: string[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const c = ws.getCell(r, 1);
      expect(typeof c.value).toBe('string'); // never a number or formula object
      expect(c.type).toBe(ExcelJS.ValueType.String);
      expect(c.numFmt).toBe('@');
      out.push(c.value as string);
    }
    expect(out.sort()).toEqual([...tricky].sort());
  });

  it('writes real, formatted UTC dates, company names, code types and sources', async () => {
    const { wb } = await roundTrip([
      ser('A-1', 'company-a', 'excel', '2026-01-01T10:20:30Z', 'Importer'),
      ser('B-1', 'company-b', 'manual', '2026-02-03T04:05:06Z', 'Oli'),
    ]);
    const ws = wb.getWorksheet(SERIAL_SHEET)!;
    const row = (r: number) => (ws.getRow(r).values as unknown[]).slice(1);
    expect(row(2).slice(0, 6)).toEqual(['A-1', '', 'Company A', 'company-a', 'BARCODE', 'excel']);
    expect(row(3).slice(0, 6)).toEqual(['B-1', '', 'Company B', 'company-b', 'QR', 'manual']);
    expect((row(2)[6] as Date).toISOString()).toBe('2026-01-01T10:20:30.000Z');
    expect(ws.getCell(2, 7).numFmt).toBe(DATE_FORMAT);
    expect(row(2)[7]).toBe('Importer');
    expect(ws.getCell(1, 7).value).toBe('Registered At (UTC)');
  });

  it('summary sheet reports computable aggregates', async () => {
    const { wb } = await roundTrip([
      ser('A-1', 'company-a', 'excel', '2026-01-01T00:00:00Z'),
      ser('A-2', 'company-a', 'manual', '2026-01-02T00:00:00Z'),
      ser('B-1', 'company-b', 'manual', '2026-01-03T00:00:00Z'),
    ]);
    const sm = wb.getWorksheet(SUMMARY_SHEET)!;
    const cells: string[] = [];
    sm.eachRow((r) => cells.push((r.values as unknown[]).slice(1).join('|')));
    const all = cells.join('\n');
    expect(all).toContain('Exported at (UTC)|2026-10-03 08:09:10');
    expect(all).toContain('Exported by|Ada Admin');
    expect(all).toContain('Total serial records|3');
    expect(all).toContain('Company A|company-a|BARCODE|2');
    expect(all).toContain('Company B|company-b|QR|1');
    expect(all).toContain('excel|1');
    expect(all).toContain('manual|2');
  });

  it('empty database: valid workbook with headers, zero-record summary, no crash', async () => {
    const { wb } = await roundTrip([]);
    const ws = wb.getWorksheet(SERIAL_SHEET)!;
    expect(ws.rowCount).toBe(1);
    expect((ws.getRow(1).values as string[]).slice(1)).toEqual([...SERIAL_HEADERS]);
    const text: string[] = [];
    wb.getWorksheet(SUMMARY_SHEET)!.eachRow((r) =>
      text.push((r.values as unknown[]).slice(1).join('|')),
    );
    expect(text.join('\n')).toContain('Total serial records|0');
    expect(text.join('\n')).toContain('No serial records are registered in Firestore.');
  });

  it('handles a large dataset (20,000 rows) correctly', async () => {
    const many = Array.from({ length: 20000 }, (_, i) =>
      ser(
        String(i).padStart(10, '0'),
        i % 2 ? 'company-a' : 'company-b',
        'excel',
        '2026-01-01T00:00:00Z',
      ),
    );
    const { wb } = await roundTrip(many);
    const ws = wb.getWorksheet(SERIAL_SHEET)!;
    expect(ws.rowCount).toBe(20001);
    const seen = new Set<string>();
    for (let r = 2; r <= ws.rowCount; r++) seen.add(ws.getCell(r, 1).value as string);
    expect(seen.size).toBe(20000);
    expect(seen.has('0000000000')).toBe(true); // leading zeros intact
  }, 60_000);
});

describe('exportFilename', () => {
  it('is serial-label-export-YYYY-MM-DD.xlsx for the given date', () => {
    expect(exportFilename(new Date(2026, 9, 3, 12, 0, 0))).toBe(
      'serial-label-export-2026-10-03.xlsx',
    );
    expect(exportFilename(new Date(2026, 0, 5))).toBe('serial-label-export-2026-01-05.xlsx');
  });
});
