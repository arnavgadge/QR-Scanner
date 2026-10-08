import {
  collection,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
  Timestamp,
  where,
  type Firestore,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { COLLECTIONS, getDb } from '../firebase/firestore';
import { parseScanLog } from '../firebase/converters';
import { toAppError } from '../errors';
import { lookupExistingSerials } from '../excel/importLookup';
import type { ScanLog, ScanResult, SerialSource } from '../../types';

import { logWarn } from '../../utils/log';
export interface ScanHistoryFilters {
  result?: ScanResult;
  companyId?: string;
  source?: Exclude<SerialSource, 'excel'>;
  /** Firebase UID of the operator. */
  scannedBy?: string;
  /** Inclusive start (local time). */
  from?: Date;
  /** Exclusive end (local time). */
  to?: Date;
}

export const SCAN_HISTORY_PAGE_SIZE = 25;

/** Equality-filter fields in the fixed order used by the composite indexes (firestore.indexes.json). */
export const HISTORY_EQUALITY_FIELDS = ['result', 'company_id', 'source', 'scanned_by'] as const;

/** Which equality fields a filter set uses (decides which composite index the query needs). */
export function equalityFieldsUsed(
  f: ScanHistoryFilters,
): (typeof HISTORY_EQUALITY_FIELDS)[number][] {
  const used: (typeof HISTORY_EQUALITY_FIELDS)[number][] = [];
  if (f.result) used.push('result');
  if (f.companyId) used.push('company_id');
  if (f.source) used.push('source');
  if (f.scannedBy) used.push('scanned_by');
  return used;
}

/**
 * Query: optional equality filters, optional timestamp range, newest first. Every combination is
 * served by a composite index (equality fields..., timestamp DESC) declared in
 * firestore.indexes.json; with no equality filter the automatic single-field index is enough.
 */
export function scanHistoryConstraints(f: ScanHistoryFilters): QueryConstraint[] {
  const c: QueryConstraint[] = [];
  if (f.result) c.push(where('result', '==', f.result));
  if (f.companyId) c.push(where('company_id', '==', f.companyId));
  if (f.source) c.push(where('source', '==', f.source));
  if (f.scannedBy) c.push(where('scanned_by', '==', f.scannedBy));
  if (f.from) c.push(where('timestamp', '>=', Timestamp.fromDate(f.from)));
  if (f.to) c.push(where('timestamp', '<', Timestamp.fromDate(f.to)));
  c.push(orderBy('timestamp', 'desc'));
  return c;
}

export interface ScanHistoryPage {
  entries: ScanLog[];
  /** Pass to the next call to continue; null when there is nothing more. */
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
  /** Current part number of each serial on this page (from the serials collection; '' if unknown). */
  partNumbers: Map<string, string>;
}

/**
 * One page of scan_log (never the whole collection). Fetches size+1 documents to know whether
 * another page exists. Part numbers are not stored on scan_log, so the page's serials are looked
 * up in `serials` by document ID (a couple of queries for the page, not one per row).
 */
export async function getScanHistoryPage(
  filters: ScanHistoryFilters,
  cursor: QueryDocumentSnapshot<DocumentData> | null = null,
  size = SCAN_HISTORY_PAGE_SIZE,
  db: Firestore = getDb(),
): Promise<ScanHistoryPage> {
  try {
    const q = query(
      collection(db, COLLECTIONS.scanLog),
      ...scanHistoryConstraints(filters),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(size + 1),
    );
    const snap = await getDocsFromServer(q);
    const docs = snap.docs.slice(0, size);
    const entries: ScanLog[] = [];
    for (const d of docs) {
      try {
        entries.push(parseScanLog(d.id, d.data()));
      } catch (e) {
        logWarn('Skipping malformed scan_log document', d.id, e);
      }
    }
    const partNumbers = new Map<string, string>();
    try {
      const found = await lookupExistingSerials(db, [...new Set(entries.map((e) => e.serial))]);
      for (const [serial, info] of found) partNumbers.set(serial, info.partNo);
    } catch (e) {
      logWarn('Could not load part numbers for the history page', e);
    }
    return {
      entries,
      cursor: docs.length > 0 ? (docs[docs.length - 1] ?? null) : null,
      hasMore: snap.docs.length > size,
      partNumbers,
    };
  } catch (e) {
    throw toAppError(e, 'Unable to load scan history.');
  }
}
