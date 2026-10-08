/**
 * Expected import columns (header row, first sheet). Matching ignores case, spaces and
 * punctuation, so "Serial Number", "serial_number" and "SERIALNUMBER" are equivalent.
 * The workbook produced by the Phase 5 export can be re-imported as-is.
 *   Serial Number  (required)
 *   Part Number    (required column; individual cells may be blank)
 *   Company        (required; a company name or id)  and/or  Company ID
 * Other columns (Code Type, Source, Registered At, ...) are ignored.
 */
export const REQUIRED_COLUMNS_HELP = 'Serial Number, Part Number, Company';

export const MAX_IMPORT_ROWS = 50_000;
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

/** A data row as read from the sheet (strings only; nothing validated yet). */
export interface RawImportRow {
  /** Row number in its Excel sheet (header is row 1). */
  rowNumber: number;
  /** Name of the sheet (tab) the row came from. */
  sheet?: string;
  serial: string;
  partNo: string;
  company: string;
  companyId: string;
  /** Cell-level problems found while reading (e.g. a date or an inexact number in the serial cell). */
  problems: string[];
}

export interface ImportSheetInfo {
  name: string;
  /** Data rows read from this sheet (blank rows excluded). */
  rows: number;
}

export interface ParsedImportFile {
  /** All sheets that were read, joined for display (one name when there is one sheet). */
  sheetName: string;
  /** Every sheet (tab) that had the required headers. Tabs without them are ignored. */
  sheets: ImportSheetInfo[];
  rows: RawImportRow[];
  /** Completely empty rows that were skipped. */
  blankRowsSkipped: number;
}

export type RowClass = 'new' | 'existing' | 'conflict' | 'invalid' | 'duplicate';

export interface ExistingSerialInfo {
  serial: string;
  company: string;
  companyId: string;
  partNo: string;
}

export interface ClassifiedRow {
  rowNumber: number;
  /** Sheet (tab) the row came from. */
  sheet?: string;
  /** Normalized serial ('' if missing). */
  serial: string;
  partNo: string;
  /** Resolved company id/name when known, otherwise what the file said. */
  companyId: string;
  companyName: string;
  cls: RowClass;
  /** Why invalid / why conflicting / which row it duplicates. */
  reason: string;
  /** Firestore's current record, for existing and conflict rows. */
  existing?: ExistingSerialInfo;
  /** For duplicate rows: the earlier row it repeats. */
  duplicateOfRow?: number;
}

export interface ImportCounts {
  total: number;
  valid: number;
  new: number;
  existing: number;
  conflict: number;
  duplicate: number;
  invalid: number;
}

export interface ImportPreview {
  filename: string;
  sheetName: string;
  sheets: ImportSheetInfo[];
  rows: ClassifiedRow[];
  counts: ImportCounts;
}

export interface ImportOutcome {
  filename: string;
  status: 'completed' | 'failed';
  error: string;
  totalRows: number;
  /** Records actually created in Firestore. */
  created: number;
  /** Existing (at preview time or discovered at write time) and compatible. */
  skipped: number;
  /** Conflicts at preview time plus any discovered at write time. */
  conflicts: number;
  duplicates: number;
  invalid: number;
  /** NEW rows that were not processed because the import failed part-way. */
  notProcessed: number;
  /** Serials that were new at preview time but had been registered by someone else by confirm time. */
  raceSkipped: number;
  raceConflicts: number;
}
