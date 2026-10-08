// One workbook, several tabs (for example one per company): every tab with the right headers is read.
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { normalizeRows } from '../src/services/excel/importClassify';
import { parseImportFile } from '../src/services/excel/importParser';
import type { Company } from '../src/types';

const H = ['Serial Number', 'Part Number', 'Company'];
async function book(sheets: { name: string; header?: string[]; rows: string[][] }[]) {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.addRow(s.header ?? H);
    s.rows.forEach((r) => ws.addRow(r));
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
const co = (id: string, name: string): Company => ({
  id,
  name,
  codeType: 'barcode',
  serialFormat: '',
  active: true,
  createdAt: null,
  updatedAt: null,
});

describe('multi-sheet import', () => {
  it('reads every tab that has the headers, in order, and remembers the tab of each row', async () => {
    const data = await book([
      {
        name: 'Company A',
        rows: [
          ['A-1', 'P1', 'Company A'],
          ['A-2', 'P2', 'Company A'],
        ],
      },
      { name: 'Company B', rows: [['B-1', 'P3', 'Company B']] },
    ]);
    const p = await parseImportFile(data, 'two.xlsx');
    expect(p.sheets).toEqual([
      { name: 'Company A', rows: 2 },
      { name: 'Company B', rows: 1 },
    ]);
    expect(p.sheetName).toBe('Company A, Company B');
    expect(p.rows.map((r) => [r.sheet, r.rowNumber, r.serial])).toEqual([
      ['Company A', 2, 'A-1'],
      ['Company A', 3, 'A-2'],
      ['Company B', 2, 'B-1'],
    ]);
  });

  it('ignores tabs without the headers (e.g. a notes or summary tab) as long as one tab is usable', async () => {
    const data = await book([
      { name: 'Notes', header: ['hello', 'world'], rows: [['x', 'y']] },
      { name: 'Company A', rows: [['A-1', 'P1', 'Company A']] },
    ]);
    const p = await parseImportFile(data, 'n.xlsx');
    expect(p.sheets.map((s) => s.name)).toEqual(['Company A']);
  });

  it('a tab with headers but no data does not stop the other tabs', async () => {
    const data = await book([
      { name: 'Empty', rows: [] },
      { name: 'Company B', rows: [['B-1', 'P', 'Company B']] },
    ]);
    const p = await parseImportFile(data, 'e.xlsx');
    expect(p.rows).toHaveLength(1);
  });

  it('no tab with the headers anywhere: rejected with the missing columns named', async () => {
    const data = await book([
      { name: 'One', header: ['a', 'b'], rows: [['1', '2']] },
      { name: 'Two', header: ['c'], rows: [['3']] },
    ]);
    await expect(parseImportFile(data, 'bad.xlsx')).rejects.toThrow(/Missing required column/);
  });

  it('the same serial on two tabs: the second is a duplicate and the message names the other tab', async () => {
    const data = await book([
      { name: 'Company A', rows: [['SAME-1', 'P', 'Company A']] },
      { name: 'Company B', rows: [['SAME-1', 'P', 'Company B']] },
    ]);
    const p = await parseImportFile(data, 'dup.xlsx');
    const n = normalizeRows(p.rows, [co('a', 'Company A'), co('b', 'Company B')]);
    expect(n.rows.map((r) => r.cls)).toEqual(['new', 'duplicate']);
    expect(n.rows[1]?.reason).toBe('Same serial as row 2 on sheet "Company A".');
    expect(n.serialsToCheck).toEqual(['SAME-1']);
  });

  it('a duplicate within ONE tab keeps the original short wording', async () => {
    const data = await book([
      {
        name: 'Company A',
        rows: [
          ['X-1', 'P', 'Company A'],
          ['X-1', 'P', 'Company A'],
        ],
      },
    ]);
    const p = await parseImportFile(data, 'one.xlsx');
    const n = normalizeRows(p.rows, [co('a', 'Company A')]);
    expect(n.rows[1]?.reason).toBe('Same serial as row 2.');
  });

  it('the row limit applies to all tabs together', async () => {
    const big = Array.from({ length: 30_000 }, (_, i) => [`S-${i}`, '', 'Company A']);
    const data = await book([
      { name: 'One', rows: big },
      { name: 'Two', rows: big.map((r) => [`T-${r[0]}`, '', 'Company A']) },
    ]);
    await expect(parseImportFile(data, 'huge.xlsx')).rejects.toThrow(/more than 50,000 rows/);
  }, 120_000);
});
