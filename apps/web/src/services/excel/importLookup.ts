import {
  collection,
  documentId,
  getDocsFromServer,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import { COLLECTIONS } from '../firebase/firestore';
import { chunk, mapPool } from '../../utils/pool';
import type { ExistingSerialInfo } from './importTypes';

/** Firestore allows up to 30 values in an `in` filter. */
export const LOOKUP_CHUNK = 30;
const LOOKUP_CONCURRENCY = 5;

const s = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Finds which of the given serials already exist, by document ID (the serial) in groups of 30.
 * Never reads the whole collection: only the requested IDs are fetched, and only existing
 * documents are returned/billed. Server reads only (no stale cache). Admin-only by the rules.
 */
export async function lookupExistingSerials(
  db: Firestore,
  serials: string[],
  onProgress?: (checked: number, total: number) => void,
): Promise<Map<string, ExistingSerialInfo>> {
  const found = new Map<string, ExistingSerialInfo>();
  let checked = 0;
  await mapPool(chunk(serials, LOOKUP_CHUNK), LOOKUP_CONCURRENCY, async (ids) => {
    const snap = await getDocsFromServer(
      query(collection(db, COLLECTIONS.serials), where(documentId(), 'in', ids)),
    );
    for (const d of snap.docs) {
      const data = d.data();
      found.set(d.id, {
        serial: d.id,
        company: s(data.company),
        companyId: s(data.company_id),
        partNo: s(data.part_no),
      });
    }
    checked += ids.length;
    onProgress?.(checked, serials.length);
  });
  return found;
}
