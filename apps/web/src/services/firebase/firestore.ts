import type { Firestore } from 'firebase/firestore';
import { getFirebase } from './client';

/** Firestore collection names (the data model). */
export const COLLECTIONS = {
  users: 'users',
  companies: 'companies',
  serials: 'serials',
  scanLog: 'scan_log',
  importHistory: 'import_history',
  exportHistory: 'export_history',
} as const;

export function getDb(): Firestore {
  return getFirebase().db;
}
