import {
  addDoc,
  collection,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { COLLECTIONS, getDb } from '../firebase/firestore';
import { parseExportHistory } from '../firebase/converters';
import { toAppError } from '../errors';
import type { AdminActor } from '../users/currentAdmin';
import type { ExportHistoryEntry } from '../../types';

import { logWarn } from '../../utils/log';
import { msg } from '../../i18n/core';
/** Appends an audit entry for a completed export (who, when, how many records, filename). */
export async function recordExportHistory(
  entry: { filename: string; recordCount: number },
  actor: AdminActor,
  db: Firestore = getDb(),
): Promise<void> {
  await addDoc(collection(db, COLLECTIONS.exportHistory), {
    filename: entry.filename.slice(0, 255),
    exported_by: actor.uid,
    exported_by_name: actor.name,
    exported_at: serverTimestamp(),
    record_count: entry.recordCount,
  });
}

/** Most recent exports, newest first. Always limited. Admin-only by the Firestore rules. */
export async function getExportHistory(
  count = 20,
  db: Firestore = getDb(),
): Promise<ExportHistoryEntry[]> {
  const n = Math.min(Math.max(Math.trunc(count), 1), 100);
  try {
    const snap = await getDocsFromServer(
      query(collection(db, COLLECTIONS.exportHistory), orderBy('exported_at', 'desc'), limit(n)),
    );
    const out: ExportHistoryEntry[] = [];
    for (const d of snap.docs) {
      try {
        out.push(parseExportHistory(d.id, d.data()));
      } catch (e) {
        logWarn('Skipping malformed export_history document', d.id, e);
      }
    }
    return out;
  } catch (e) {
    throw toAppError(e, msg('exportHistory.loadFailed'));
  }
}
