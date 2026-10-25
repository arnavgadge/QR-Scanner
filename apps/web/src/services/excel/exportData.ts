import {
  collection,
  documentId,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
  Timestamp,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { COLLECTIONS } from '../firebase/firestore';
import { parseCompany } from '../firebase/converters';
import type { Company } from '../../types';
import type { ExportSerial } from './exportDataset';

import { logWarn } from '../../utils/log';
/**
 * Firestore reads for the export. This is deliberately NOT the Recent Scans query: it reads the
 * complete `serials` collection (the one place a full read is intended), in fixed-size pages
 * ordered by document ID, so memory use and per-request time stay bounded however large it grows.
 * Admin-only: the security rules allow `list` on serials for admins and no one else.
 * Reads use getDocsFromServer: the default getDocs silently falls back to the local cache when the
 * server is unreachable, which would produce a partial/stale export that looks successful.
 */

export const EXPORT_PAGE_SIZE = 1000;

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function toExportSerial(doc: QueryDocumentSnapshot<DocumentData>): ExportSerial {
  const d = doc.data();
  const scannedAt = d.scanned_at instanceof Timestamp ? d.scanned_at.toDate() : null;
  const incomplete =
    typeof d.company !== 'string' ||
    typeof d.company_id !== 'string' ||
    typeof d.source !== 'string' ||
    typeof d.scanned_by_name !== 'string' ||
    scannedAt === null;
  return {
    serial: doc.id,
    partNo: str(d.part_no),
    company: str(d.company),
    companyId: str(d.company_id),
    source: str(d.source),
    scannedAt,
    scannedByName: str(d.scanned_by_name),
    incomplete,
  };
}

/** Reads every serial exactly once, page by page. */
export async function fetchAllSerials(
  db: Firestore,
  onProgress?: (readSoFar: number) => void,
  pageSize = EXPORT_PAGE_SIZE,
): Promise<ExportSerial[]> {
  const all: ExportSerial[] = [];
  let last: QueryDocumentSnapshot<DocumentData> | undefined;
  for (;;) {
    const base = [orderBy(documentId()), limit(pageSize)] as const;
    const q = last
      ? query(collection(db, COLLECTIONS.serials), ...base, startAfter(last))
      : query(collection(db, COLLECTIONS.serials), ...base);
    const snap = await getDocsFromServer(q);
    for (const d of snap.docs) all.push(toExportSerial(d));
    onProgress?.(all.length);
    if (snap.docs.length < pageSize) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return all;
}

/** One read of the (small) companies collection, including inactive ones, for name/code type. */
export async function fetchAllCompanies(db: Firestore): Promise<Company[]> {
  const snap = await getDocsFromServer(collection(db, COLLECTIONS.companies));
  const companies: Company[] = [];
  for (const d of snap.docs) {
    try {
      companies.push(parseCompany(d.id, d.data()));
    } catch (e) {
      logWarn('Skipping malformed company document in export', d.id, e);
    }
  }
  return companies;
}
