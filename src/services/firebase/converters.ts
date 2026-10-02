import { Timestamp, type DocumentData } from 'firebase/firestore';
import { AppError } from '../errors';
import type {
  CodeType,
  Company,
  ScanLog,
  ScanResult,
  SerialRecord,
  SerialSource,
  User,
  UserRole,
} from '../../types';

/**
 * Firestore document (snake_case, Timestamps) -> application type.
 * Validates shape at runtime; malformed documents throw AppError('invalid-data').
 * Keep Firestore details in this file so the UI never sees Timestamps.
 */

type Raw = Record<string, unknown>;

const ROLES: readonly UserRole[] = ['operator', 'admin'];
const CODE_TYPES: readonly CodeType[] = ['barcode', 'qr'];
const SOURCES: readonly SerialSource[] = ['excel', 'manual', 'scan'];
const RESULTS: readonly ScanResult[] = ['new', 'duplicate'];

function malformed(ctx: string, field: string): AppError {
  return new AppError('invalid-data', 'Unable to read stored data. Contact an administrator.', {
    cause: new Error(`Malformed ${ctx}: field "${field}"`),
  });
}

function str(d: Raw, key: string, ctx: string): string {
  const v = d[key];
  if (typeof v !== 'string') throw malformed(ctx, key);
  return v;
}

function bool(d: Raw, key: string, ctx: string): boolean {
  const v = d[key];
  if (typeof v !== 'boolean') throw malformed(ctx, key);
  return v;
}

function oneOf<T extends string>(list: readonly T[], d: Raw, key: string, ctx: string): T {
  const v = d[key];
  const found = list.find((x) => x === v);
  if (found === undefined) throw malformed(ctx, key);
  return found;
}

function iso(v: unknown): string | null {
  return v instanceof Timestamp ? v.toDate().toISOString() : null;
}

export function parseUser(uid: string, data: DocumentData): User {
  const d: Raw = data;
  const ctx = `users/${uid}`;
  return {
    uid,
    name: str(d, 'name', ctx),
    email: str(d, 'email', ctx),
    role: oneOf(ROLES, d, 'role', ctx),
    active: bool(d, 'active', ctx),
    createdAt: iso(d.created_at),
  };
}

export function parseCompany(id: string, data: DocumentData): Company {
  const d: Raw = data;
  const ctx = `companies/${id}`;
  return {
    id,
    name: str(d, 'name', ctx),
    codeType: oneOf(CODE_TYPES, d, 'code_type', ctx),
    serialFormat: str(d, 'serial_format', ctx),
    active: bool(d, 'active', ctx),
    createdAt: iso(d.created_at),
    updatedAt: iso(d.updated_at),
  };
}

export function parseSerial(id: string, data: DocumentData): SerialRecord {
  const d: Raw = data;
  const ctx = `serials/${id}`;
  return {
    serial: id,
    partNo: typeof d.part_no === 'string' ? d.part_no : '',
    company: str(d, 'company', ctx),
    companyId: str(d, 'company_id', ctx),
    source: oneOf(SOURCES, d, 'source', ctx),
    scannedAt: iso(d.scanned_at),
    scannedBy: str(d, 'scanned_by', ctx),
    scannedByName: str(d, 'scanned_by_name', ctx),
  };
}

export function parseScanLog(id: string, data: DocumentData): ScanLog {
  const d: Raw = data;
  const ctx = `scan_log/${id}`;
  return {
    id,
    serial: str(d, 'serial', ctx),
    result: oneOf(RESULTS, d, 'result', ctx),
    company: str(d, 'company', ctx),
    companyId: str(d, 'company_id', ctx),
    source: oneOf(SOURCES, d, 'source', ctx),
    scannedBy: str(d, 'scanned_by', ctx),
    scannedByName: str(d, 'scanned_by_name', ctx),
    timestamp: iso(d.timestamp),
  };
}
