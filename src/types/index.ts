/** Core domain types. Names are shared across all phases — keep them stable. */

export type UserRole = 'operator' | 'admin';
export type CodeType = 'barcode' | 'qr';
export type SerialSource = 'excel' | 'manual' | 'scan';
export type ScanResult = 'new' | 'duplicate';

export interface User {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
}

export interface Company {
  id: string;
  name: string;
  codeType: CodeType;
  /** Serial format rule (e.g. a regex source or pattern string); interpreted in Phase 3. */
  serialFormat: string;
  active: boolean;
}

export interface SerialRecord {
  serial: string;
  partNumber: string;
  companyId: string;
  source: SerialSource;
  /** ISO 8601 timestamp; Firestore Timestamp conversion happens in the service layer. */
  scannedAt: string;
  /** User uid. */
  scannedBy: string;
}

export interface ScanLog {
  id: string;
  serial: string;
  companyId: string;
  result: ScanResult;
  source: SerialSource;
  scannedAt: string;
  scannedBy: string;
}
