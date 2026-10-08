/**
 * Core domain types (application-level, camelCase). Firestore documents use snake_case and
 * Timestamps; conversion happens only in services/firebase/converters.ts.
 * Timestamps here are ISO 8601 strings, or null when the server has not supplied one.
 */

export type UserRole = 'operator' | 'admin';
export type CodeType = 'barcode' | 'qr';
export type SerialSource = 'excel' | 'manual' | 'scan';
export type ScanResult = 'new' | 'duplicate';

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
}
