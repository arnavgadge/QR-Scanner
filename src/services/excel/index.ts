/** Excel boundary (XLSX library arrives in a later phase). */
export interface ExcelImportRow {
  serial: string;
  partNumber: string;
  companyId?: string;
}

export interface ExcelImportIssue {
  row: number;
  message: string;
}

export interface ExcelService {
  parseImport(file: File): Promise<{ rows: ExcelImportRow[]; issues: ExcelImportIssue[] }>;
  exportRecords(records: import('../../types').SerialRecord[]): Promise<Blob>;
}
