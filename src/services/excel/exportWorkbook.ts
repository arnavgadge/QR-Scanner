import type { ExportDataset } from './exportDataset';
import { SORT_DESCRIPTION } from './exportDataset';

export const SERIAL_SHEET = 'Serial Records';
export const SUMMARY_SHEET = 'Export Summary';

export const SERIAL_HEADERS = [
  'Serial Number',
  'Part Number',
  'Company',
  'Company ID',
  'Code Type',
  'Source',
  'Registered At (UTC)',
  'Registered By',
] as const;

export const DATE_FORMAT = 'yyyy-mm-dd hh:mm:ss';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 'YYYY-MM-DD HH:mm:ss' in UTC. All timestamps in the workbook are UTC (Firestore server time). */
export function formatUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

const CHUNK = 2000;
const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Builds the .xlsx bytes. ExcelJS is loaded on demand so it is not part of the main bundle.
 *
 * Serial/part/company-id cells are written as strings AND formatted as Text ('@'), so Excel
 * never converts "00012345" to 12345 or a long numeric serial to scientific notation.
 * Rows are written in chunks with a yield between them so the page stays responsive.
 */
export async function buildWorkbook(dataset: ExportDataset): Promise<ArrayBuffer> {
  const mod = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Serial Scanning & Label System';
  wb.created = dataset.summary.exportedAt;

  // ---- Sheet 1: Serial Records ----
  const ws = wb.addWorksheet(SERIAL_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: SERIAL_HEADERS[0], key: 'serial', width: 28 },
    { header: SERIAL_HEADERS[1], key: 'partNo', width: 20 },
    { header: SERIAL_HEADERS[2], key: 'company', width: 24 },
    { header: SERIAL_HEADERS[3], key: 'companyId', width: 20 },
    { header: SERIAL_HEADERS[4], key: 'codeType', width: 12 },
    { header: SERIAL_HEADERS[5], key: 'source', width: 10 },
    { header: SERIAL_HEADERS[6], key: 'registeredAt', width: 22 },
    { header: SERIAL_HEADERS[7], key: 'registeredBy', width: 24 },
  ];
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

  const rows = dataset.rows;
  for (let i = 0; i < rows.length; i += CHUNK) {
    for (const r of rows.slice(i, i + CHUNK)) {
      const row = ws.addRow([
        r.serial,
        r.partNo,
        r.company,
        r.companyId,
        r.codeType,
        r.source,
        r.registeredAt,
        r.registeredBy,
      ]);
      row.getCell(1).numFmt = '@';
      row.getCell(2).numFmt = '@';
      row.getCell(4).numFmt = '@';
      row.getCell(7).numFmt = DATE_FORMAT;
    }
    await yieldToUi();
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: SERIAL_HEADERS.length } };

  // ---- Sheet 2: Export Summary ----
  const s = dataset.summary;
  const sm = wb.addWorksheet(SUMMARY_SHEET);
  sm.columns = [{ width: 34 }, { width: 24 }, { width: 14 }, { width: 12 }];
  const heading = (text: string) => {
    const r = sm.addRow([text]);
    r.font = { bold: true, size: 12 };
    return r;
  };
  const tableHeader = (cols: string[]) => {
    const r = sm.addRow(cols);
    r.font = { bold: true };
    r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  };
  const text = (cells: (string | number)[]) => {
    const r = sm.addRow(cells);
    // Labels/IDs as text; numeric columns stay numbers.
    cells.forEach((v, i) => {
      if (typeof v === 'string') r.getCell(i + 1).numFmt = '@';
    });
  };

  const title = sm.addRow(['Serial Data Export']);
  title.font = { bold: true, size: 14 };
  sm.addRow([]);
  text(['Exported at (UTC)', formatUtc(s.exportedAt)]);
  text(['Exported by', s.exportedBy]);
  text(['Data source', 'Firestore: serials collection (complete read)']);
  text(['Sort order', SORT_DESCRIPTION]);
  text(['All timestamps', 'UTC (Firestore server time)']);
  sm.addRow([]);
  heading('Totals');
  text(['Total serial records', s.total]);
  text(['Earliest registration (UTC)', s.earliest ? formatUtc(s.earliest) : '-']);
  text(['Latest registration (UTC)', s.latest ? formatUtc(s.latest) : '-']);
  text(['Records with incomplete data', s.incomplete]);
  text(['Records with unknown company', s.unresolvedCompany]);
  if (s.total === 0) {
    sm.addRow([]);
    text(['Note', 'No serial records are registered in Firestore.']);
  }
  sm.addRow([]);
  heading('Records by company');
  tableHeader(['Company', 'Company ID', 'Code Type', 'Records']);
  if (s.byCompany.length === 0) text(['(none)', '', '', 0]);
  for (const c of s.byCompany) text([c.company, c.companyId, c.codeType, c.count]);
  sm.addRow([]);
  heading('Records by source');
  tableHeader(['Source', 'Records']);
  if (s.bySource.length === 0) text(['(none)', 0]);
  for (const c of s.bySource) text([c.label, c.count]);
  sm.addRow([]);
  heading('Records by code type');
  tableHeader(['Code Type', 'Records']);
  if (s.byCodeType.length === 0) text(['(none)', 0]);
  for (const c of s.byCodeType) text([c.label, c.count]);

  return wb.xlsx.writeBuffer();
}
