import {
  collection,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  type Firestore,
} from 'firebase/firestore';
import { COLLECTIONS, getDb } from '../firebase/firestore';
import { parseImportHistory } from '../firebase/converters';
import { toAppError } from '../errors';
import type { ImportHistoryEntry } from '../../types';

import { logWarn } from '../../utils/log';
import { msg } from '../../i18n/core';
/** Most recent imports, newest first. Always limited. Admin-only by the Firestore rules. */
export async function getImportHistory(
  count = 20,
  db: Firestore = getDb(),
): Promise<ImportHistoryEntry[]> {
  const n = Math.min(Math.max(Math.trunc(count), 1), 100);
  try {
    const snap = await getDocsFromServer(
      query(collection(db, COLLECTIONS.importHistory), orderBy('imported_at', 'desc'), limit(n)),
    );
    const out: ImportHistoryEntry[] = [];
    for (const d of snap.docs) {
      try {
        out.push(parseImportHistory(d.id, d.data()));
      } catch (e) {
        logWarn('Skipping malformed import_history document', d.id, e);
      }
    }
    return out;
  } catch (e) {
    throw toAppError(e, msg('importHistory.loadFailed'));
  }
}
