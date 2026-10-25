import { describe, expect, it } from 'vitest';
import { parseImportFile, cellToString } from '../src/services/excel/importParser';
import { makeXlsx, STD_HEADERS } from './helpers';

describe('parseImportFile — parsing', () => {
  it('reads rows with the Excel row number, header at row 1', async () => {
    const buf = await makeXlsx(STD_HEADERS, [
      ['A-1', 'PN-1', 'Company A'],
      ['A-2', '', 'Company B'],
    ]);
    const p = await parseImportFile(buf, 'a.xlsx');
    expect(p.rows).toEqual([
      {
        rowNumber: 2,
        sheet: 'Serial Records',
        serial: 'A-1',
        partNo: 'PN-1',
        company: 'Company A',
        companyId: '',
        problems: [],
      },
      {
        rowNumber: 3,
        sheet: 'Serial Records',
        serial: 'A-2',
        partNo: '',
        company: 'Company B',
        companyId: '',
        problems: [],
      },
    ]);
    expect(p.sheetName).toBe('Serial Records');
  });

  it('matches headers ignoring case/spaces/punctuation and ignores extra columns', async () => {
    const buf = await makeXlsx(
      ['  serial_number ', 'PART NO', 'Company ID', 'Code Type', 'Source', 'Registered At (UTC)'],
      [['A-1', 'PN-1', 'company-a', 'BARCODE', 'manual', '2026-01-01']],
    );
    const p = await parseImportFile(buf, 'a.xlsx');
    expect(p.rows[0]).toMatchObject({
      serial: 'A-1',
      partNo: 'PN-1',
      companyId: 'company-a',
      company: '',
    });
  });

  it('accepts a workbook produced by the Phase 5 export header set', async () => {
    const buf = await makeXlsx(
      [
        'Serial Number',
        'Part Number',
        'Company',
        'Company ID',
        'Code Type',
        'Source',
        'Registered At (UTC)',
        'Registered By',
      ],
      [
        [
          '00012345',
          '',
          'Company A',
          'company-a',
          'BARCODE',
          'excel',
          '2026-01-01 00:00:00',
          'Ada',
        ],
      ],
    );
    const p = await parseImportFile(buf, 'serial-label-export-2026-10-03.xlsx');
    expect(p.rows[0]?.serial).toBe('00012345');
  });

  it('prefers the "Serial Records" sheet over the first sheet', async () => {
    const wb = new (await import('exceljs')).default.Workbook();
    wb.addWorksheet('Summary').addRow(['nothing', 'useful']);
    const ws = wb.addWorksheet('Serial Records');
    ws.addRow(STD_HEADERS);
    ws.addRow(['A-1', '', 'Company A']);
    const buf = new Uint8Array(await wb.xlsx.writeBuffer());
    expect((await parseImportFile(buf, 'a.xlsx')).rows).toHaveLength(1);
  });

  it('skips completely blank rows and keeps true row numbers', async () => {
    const buf = await makeXlsx(STD_HEADERS, [
      ['A-1', '', 'Company A'],
      [null, null, null],
      ['A-2', '', 'Company A'],
    ]);
    const p = await parseImportFile(buf, 'a.xlsx');
    expect(p.rows.map((r) => r.rowNumber)).toEqual([2, 4]);
    expect(p.blankRowsSkipped).toBe(1);
  });
});

describe('parseImportFile — required columns / file validation', () => {
  it.each([
    [['Part Number', 'Company'], 'Serial Number'],
    [['Serial Number', 'Company'], 'Part Number'],
    [['Serial Number', 'Part Number'], 'Company'],
  ])('rejects the whole file when a required column is missing (%j)', async (headers, missing) => {
    const buf = await makeXlsx(headers, [['x', 'y']]);
    await expect(parseImportFile(buf, 'a.xlsx')).rejects.toThrow(
      new RegExp(`Missing required column.*${missing}`),
    );
  });

  it('rejects non-.xlsx names, empty and corrupted files, and header-only files', async () => {
    const ok = await makeXlsx(STD_HEADERS, [['A-1', '', 'Company A']]);
    await expect(parseImportFile(ok, 'data.csv')).rejects.toThrow(/Only \.xlsx/);
    await expect(parseImportFile(new Uint8Array(0), 'a.xlsx')).rejects.toThrow(/empty/);
    await expect(parseImportFile(new TextEncoder().encode('not a zip'), 'a.xlsx')).rejects.toThrow(
      /could not be read/,
    );
    await expect(parseImportFile(await makeXlsx(STD_HEADERS, []), 'a.xlsx')).rejects.toThrow(
      /no data rows/,
    );
  });
});

describe('cell normalization', () => {
  it('trims strings, converts safe integers, keeps characters intact', () => {
    expect(cellToString('  ab c  ').text).toBe('ab c');
    expect(cellToString(12345).text).toBe('12345');
    expect(cellToString('0O0I1l').text).toBe('0O0I1l'); // no look-alike conversion
    expect(cellToString(null).text).toBe('');
  });
  it('flags inexact numbers, dates and error values instead of importing wrong data', () => {
    expect(cellToString(1.2345e29).problem).toMatch(/cannot be read exactly/);
    expect(cellToString(0.5).problem).toBeTruthy();
    expect(cellToString(new Date()).problem).toMatch(/date/);
    expect(cellToString({ error: '#N/A' } as never).problem).toMatch(/error/i);
  });
  it('reads rich text, formula results and hyperlinks as text', () => {
    expect(cellToString({ richText: [{ text: 'AB' }, { text: '-1' }] } as never).text).toBe('AB-1');
    expect(cellToString({ formula: 'A1', result: 'XY-9' } as never).text).toBe('XY-9');
    expect(cellToString({ text: 'LINK-1', hyperlink: 'http://x' } as never).text).toBe('LINK-1');
  });

  it('a numeric serial cell with a lost leading zero is imported as the number text (cannot be recovered)', async () => {
    const buf = await makeXlsx(STD_HEADERS, [[12345, '', 'Company A']]);
    expect((await parseImportFile(buf, 'a.xlsx')).rows[0]?.serial).toBe('12345');
  });
  it('an inexact long numeric serial cell becomes a row problem, not a silently wrong serial', async () => {
    const buf = await makeXlsx(STD_HEADERS, [
      [Number('123456789012345678901234'), '', 'Company A'],
    ]);
    const row = (await parseImportFile(buf, 'a.xlsx')).rows[0]!;
    expect(row.serial).toBe('');
    expect(row.problems[0]).toMatch(/Serial Number: Numeric value/);
  });
});
