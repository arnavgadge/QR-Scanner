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
}

/** companies/{companyId} */
export interface Company {
  id: string;
  name: string;
  /** Label OUTPUT format (not an input mode). */
  codeType: CodeType;
  /** Serial format pattern, e.g. "13WAA#########"; interpreted in Phase 3. */
  serialFormat: string;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
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
