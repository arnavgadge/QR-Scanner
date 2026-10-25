/**
 * Core domain types (application-level, camelCase). Firestore documents use snake_case and
 * Timestamps; conversion happens only in services/firebase/converters.ts.
 * Timestamps here are ISO 8601 strings, or null when the server has not supplied one.
 */
import type { Msg } from '../i18n/core';

export type UserRole = 'operator' | 'admin';
export type CodeType = 'barcode' | 'qr';
export type SerialSource = 'excel' | 'manual' | 'scan';
export type ScanResult = 'new' | 'duplicate';

/** UI language. Printed labels, codes, serials and part numbers are never translated. */
export type Language = 'en' | 'hi' | 'mr';
export type Theme = 'light' | 'dark';

/** users/{uid}.preferences: the person's own display choices (each optional, validated by rules). */
export interface UserPreferences {
  language?: Language;
  theme?: Theme;
}

/** users/{uid} */
export interface User {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: string | null;
  /** Display name of the admin who last changed role/active ('' if never changed). */
  updatedByName: string;
  updatedAt: string | null;
  /** Saved display preferences; `{}` when none (or when the stored values are not recognised). */
  preferences: UserPreferences;
}

/** companies/{companyId} */
export interface Company {
  id: string;
  name: string;
  /**
   * Label OUTPUT format (not an input mode). `null` means the stored value is missing or not a
   * supported type: the company is then shown as "not configured" and no label is ever generated
   * (nothing silently falls back to barcode or QR).
   */
  codeType: CodeType | null;
  /** Serial format pattern, e.g. "13WAA#########"; interpreted in Phase 3. */
  serialFormat: string;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  /** Display name of the admin who last changed this company ('' if never changed via the admin UI). */
  updatedByName: string;
  /**
   * Label stock for this company (desktop server only). Absent = the default label size from
   * config/label.ts (the web app always uses the default).
   */
  labelSize?: LabelSizeMm;
}

/** Printed label size in millimetres. */
export interface LabelSizeMm {
  widthMm: number;
  heightMm: number;
}

/** serials/{serial} — the serial is the document ID. */
export interface SerialRecord {
  serial: string;
  partNo: string;
  /** Company display name at registration time. */
  company: string;
  companyId: string;
  source: SerialSource;
  scannedAt: string | null;
  /** Firebase UID of the operator. */
  scannedBy: string;
  scannedByName: string;
  /** Station (computer) it was registered on; desktop server only. */
  nodeName?: string;
  /** Imported from an Excel file (desktop server): that file's name. */
  importFile?: string;
}

/** import_history/{autoId} — one entry per Excel import (admin-only). */
export interface ImportHistoryEntry {
  id: string;
  filename: string;
  importedBy: string;
  importedByName: string;
  importedAt: string | null;
  totalRows: number;
  /** Records actually created. */
  newCount: number;
  skipped: number;
  conflicts: number;
  duplicates: number;
  invalid: number;
  status: 'completed' | 'failed';
  error: string;
}

/** export_history/{autoId} — one entry per Excel export (admin-only). */
export interface ExportHistoryEntry {
  id: string;
  filename: string;
  exportedBy: string;
  exportedByName: string;
  exportedAt: string | null;
  recordCount: number;
}

/** scan_log/{autoId} — every attempt, including duplicates. */
export interface ScanLog {
  id: string;
  serial: string;
  result: ScanResult;
  company: string;
  companyId: string;
  source: SerialSource;
  scannedBy: string;
  scannedByName: string;
  timestamp: string | null;
  /** Station (computer) the attempt came from; desktop server only. */
  nodeName?: string;
  /**
   * Desktop server: what this history row is. 'scan' = a station registered or checked the serial
   * (default); 'import' = added by an Excel import; 'reprint' = an administrator printed the label
   * of an already registered serial again.
   */
  kind?: ScanLogKind;
}

export type ScanLogKind = 'scan' | 'import' | 'reprint';

/** A serial found by the admin search, with its company (for the label layout). */
export interface FoundSerial {
  record: SerialRecord;
  /** null if the company no longer exists (the label cannot be printed then). */
  company: Company | null;
}

/** What happened to one row of an Excel import. */
export type ImportItemOutcome = 'added' | 'skipped' | 'conflict' | 'duplicate' | 'invalid';

export interface ImportItem {
  rowNumber: number;
  sheet: string;
  serial: string;
  companyName: string;
  partNo: string;
  outcome: ImportItemOutcome;
  /** English reason (and translatable form when known). */
  reason: string;
  reasonMsg?: Msg;
}

export interface ImportDetails {
  importId: string;
  filename: string;
  /** false for imports made before details were recorded. */
  recorded: boolean;
  items: ImportItem[];
}
