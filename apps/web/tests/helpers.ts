import ExcelJS from 'exceljs';

/** Builds an .xlsx in memory: header row + data rows (values written exactly as given). */
export async function makeXlsx(
  headers: string[],
  rows: (string | number | null | Date | object)[][],
  sheetName = 'Serial Records',
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r as ExcelJS.CellValue[]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export const STD_HEADERS = ['Serial Number', 'Part Number', 'Company'];
