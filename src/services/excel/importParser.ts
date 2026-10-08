import type { CellValue } from 'exceljs';
import { AppError } from '../errors';
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  REQUIRED_COLUMNS_HELP,
  type ImportSheetInfo,
  type ParsedImportFile,
  type RawImportRow,
} from './importTypes';

const fail = (message: string) => new AppError('invalid-data', message);

/** Lower-case and drop everything except letters/digits: "Serial_Number " -> "serialnumber". */
const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

const ALIASES = {
  serial: ['serialnumber', 'serial', 'serialno', 'serialnum'],
  partNo: ['partnumber', 'partno', 'part', 'partnum'],
  company: ['company', 'companyname'],
  companyId: ['companyid'],
} as const;

type Field = keyof typeof ALIASES;

/**
 * Converts one cell to a string without altering meaningful characters.
 * Numbers become their exact decimal text only when that is lossless; an inexact number
 * (e.g. a long numeric serial Excel already rounded) is reported instead of imported wrongly.
 */
export function cellToString(v: CellValue): { text: string; problem?: string } {
  if (v === null || v === undefined) return { text: '' };
  if (typeof v === 'string') return { text: v.trim() };
  if (typeof v === 'number') {
    if (Number.isSafeInteger(v)) return { text: String(v) };
    return {
      text: '',
      problem: `Numeric value ${v} cannot be read exactly. Format the column as Text in Excel.`,
    };
  }
  if (typeof v === 'boolean') return { text: '', problem: 'Unexpected TRUE/FALSE value.' };
  if (v instanceof Date) return { text: '', problem: 'Unexpected date value.' };
  if (typeof v === 'object') {
    if ('richText' in v)
      return {
        text: v.richText
          .map((r) => r.text)
          .join('')
          .trim(),
      };
    if ('result' in v && v.result !== undefined) return cellToString(v.result as CellValue);
    if ('text' in v && typeof v.text === 'string') return { text: v.text.trim() };
    if ('error' in v) return { text: '', problem: `Excel error value ${String(v.error)}.` };
  }
  return { text: '', problem: 'Unsupported cell content.' };
}

/**
 * Parses an .xlsx workbook locally (no network, no Firestore). Throws AppError with a clear
 * message if the file or its header is unusable, so nothing is ever written for a bad file.
 */
export async function parseImportFile(
  data: ArrayBuffer | Uint8Array,
  filename: string,
): Promise<ParsedImportFile> {
  if (!/\.xlsx$/i.test(filename)) {
    throw fail('Only .xlsx files are supported. Save the workbook as "Excel Workbook (.xlsx)".');
  }
  const bytes = data.byteLength;
  if (bytes === 0) throw fail('The file is empty.');
  if (bytes > MAX_IMPORT_BYTES)
    throw fail('The file is larger than 25 MB. Split it and import in parts.');

  const mod = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as ArrayBuffer);
  } catch {
    throw fail('The file could not be read as an Excel workbook (.xlsx). It may be corrupted.');
  }
  if (wb.worksheets.length === 0) throw fail('The workbook has no sheets.');

  // Every sheet (tab) that has the required headers is read, so one workbook can carry one tab per
  // company. Tabs without them (for example the export's "Export Summary") are ignored.
  const preferred = wb.getWorksheet('Serial Records') ?? wb.worksheets[0]!;
  const rows: RawImportRow[] = [];
  const sheets: ImportSheetInfo[] = [];
  let blankRowsSkipped = 0;
  for (const ws of wb.worksheets) {
    const cols = findColumns(ws);
    if (missingColumns(cols).length > 0) continue;
    const read = readSheet(ws, cols, rows.length);
    rows.push(...read.rows);
    blankRowsSkipped += read.blank;
    sheets.push({ name: ws.name, rows: read.rows.length });
  }
  if (sheets.length === 0) {
    // Nothing usable anywhere: explain the problem on the sheet the admin most likely meant.
    const missing = missingColumns(findColumns(preferred));
    throw fail(
      `Missing required column(s): ${missing.join(', ')}. The first row must contain these headers: ${REQUIRED_COLUMNS_HELP}.`,
    );
  }
  if (rows.length === 0) throw fail('The file has a header row but no data rows.');
  return { sheetName: sheets.map((s) => s.name).join(', '), sheets, rows, blankRowsSkipped };
}

type Columns = Partial<Record<Field, number>>;
type Sheet = import('exceljs').Worksheet;

function findColumns(ws: Sheet): Columns {
  const cols: Columns = {};
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const h = key(cellToString(cell.value).text);
    for (const field of Object.keys(ALIASES) as Field[]) {
      if (cols[field] === undefined && (ALIASES[field] as readonly string[]).includes(h)) {
        cols[field] = colNumber;
      }
    }
  });
  return cols;
}

function missingColumns(cols: Columns): string[] {
  const missing: string[] = [];
  if (cols.serial === undefined) missing.push('Serial Number');
  if (cols.partNo === undefined) missing.push('Part Number');
  if (cols.company === undefined && cols.companyId === undefined) missing.push('Company');
  return missing;
}

function readSheet(ws: Sheet, cols: Columns, rowsSoFar: number) {
  const rows: RawImportRow[] = [];
  let blank = 0;
  const last = ws.actualRowCount > 0 ? ws.rowCount : 1;
  for (let r = 2; r <= last; r++) {
    const row = ws.getRow(r);
    const problems: string[] = [];
    const read = (field: Field, label: string): string => {
      const col = cols[field];
      if (col === undefined) return '';
      const { text, problem } = cellToString(row.getCell(col).value);
      if (problem) problems.push(`${label}: ${problem}`);
      return text;
    };
    const serial = read('serial', 'Serial Number');
    const partNo = read('partNo', 'Part Number');
    const company = read('company', 'Company');
    const companyId = read('companyId', 'Company ID');
    if (!serial && !partNo && !company && !companyId && problems.length === 0) {
      blank++;
      continue;
    }
    rows.push({ rowNumber: r, sheet: ws.name, serial, partNo, company, companyId, problems });
    if (rowsSoFar + rows.length > MAX_IMPORT_ROWS) {
      throw fail(
        `The file has more than ${MAX_IMPORT_ROWS.toLocaleString()} rows. Split it and import in parts.`,
      );
    }
  }
  return { rows, blank };
}
