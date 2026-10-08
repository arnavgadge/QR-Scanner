import { FirebaseError } from 'firebase/app';
import {
  addDoc,
  collection,
  runTransaction,
  serverTimestamp,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase/firestore';
import { COLLECTIONS } from '../firebase/firestore';
import { toAppError } from '../errors';
import { chunk, mapPool } from '../../utils/pool';
import { serialDocRef } from '../serial/serialRepository';
import { compareWithExisting } from './importClassify';
import type { ClassifiedRow, ImportOutcome, ImportPreview } from './importTypes';

/** Records created per transaction (each transaction re-reads every serial it is about to create). */
export const WRITE_CHUNK = 25;
const WRITE_CONCURRENCY = 4;
const MAX_ATTEMPTS = 4;

export interface ImportActor {
  uid: string;
  name: string;
}

type ChunkResult = { row: ClassifiedRow; result: 'created' | 'skipped' | 'conflict' };

/**
 * Creates one chunk of NEW rows safely. Inside a single transaction every serial is READ again
 * and created only if it is still absent, so a serial registered after the preview (by an
 * operator or another admin) is never overwritten: it is skipped if compatible, otherwise
 * counted as a conflict.
 *
 * Like Phase 3, a loser of a race can see permission-denied (the rules treat a write to an
 * existing document as an update, and are evaluated before Firestore's own retry), so the
 * transaction is re-run; the re-run reads the winner's record and takes the skip/conflict path.
 */
async function createChunk(
  db: Firestore,
  rows: ClassifiedRow[],
  actor: ImportActor,
): Promise<ChunkResult[]> {
  const run = () =>
    runTransaction(db, async (tx) => {
      const refs = rows.map((r) => serialDocRef(db, r.serial));
      const snaps: DocumentSnapshot[] = [];
      for (const ref of refs) snaps.push(await tx.get(ref));
      const out: ChunkResult[] = [];
      rows.forEach((row, i) => {
        const snap = snaps[i]!;
        if (snap.exists()) {
          const d = snap.data();
          const cmp = compareWithExisting(row, {
            serial: row.serial,
            company: typeof d.company === 'string' ? d.company : '',
            companyId: typeof d.company_id === 'string' ? d.company_id : '',
            partNo: typeof d.part_no === 'string' ? d.part_no : '',
          });
          out.push({ row, result: cmp.compatible ? 'skipped' : 'conflict' });
          return;
        }
        tx.set(refs[i]!, {
          serial: row.serial,
          part_no: row.partNo,
          company: row.companyName,
          company_id: row.companyId,
          source: 'excel',
          scanned_at: serverTimestamp(),
          scanned_by: actor.uid,
          scanned_by_name: actor.name,
        });
        out.push({ row, result: 'created' });
      });
      return out;
    });

  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      const retryable =
        e instanceof FirebaseError &&
        (e.code === 'permission-denied' ||
          e.code === 'aborted' ||
          e.code === 'failed-precondition');
      if (!retryable || attempt >= MAX_ATTEMPTS) throw e;
    }
  }
}

/**
 * Writes the preview's NEW rows. A mid-way failure returns status 'failed' (records already created
 * stay; nothing is rolled back or overwritten) so the caller can still record the history entry. Existing, conflicting, duplicate and invalid rows are never
 * written. Never overwrites. Records get source "excel" and server timestamps.
 */
export async function executeImport(
  db: Firestore,
  preview: ImportPreview,
  actor: ImportActor,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportOutcome> {
  const newRows = preview.rows.filter((r) => r.cls === 'new');
  const c = preview.counts;
  const outcome: ImportOutcome = {
    filename: preview.filename,
    status: 'completed',
    error: '',
    totalRows: c.total,
    created: 0,
    skipped: c.existing,
    conflicts: c.conflict,
    duplicates: c.duplicate,
    invalid: c.invalid,
    notProcessed: 0,
    raceSkipped: 0,
    raceConflicts: 0,
  };

  let processed = 0;
  let failure: unknown;
  await mapPool(chunk(newRows, WRITE_CHUNK), WRITE_CONCURRENCY, async (rows) => {
    if (failure) return; // stop starting new chunks after a failure
    try {
      for (const r of await createChunk(db, rows, actor)) {
        if (r.result === 'created') outcome.created++;
        else if (r.result === 'skipped') {
          outcome.skipped++;
          outcome.raceSkipped++;
        } else {
          outcome.conflicts++;
          outcome.raceConflicts++;
        }
      }
      processed += rows.length;
      onProgress?.(processed, newRows.length);
    } catch (e) {
      failure = e;
    }
  });

  if (failure) {
    outcome.status = 'failed';
    outcome.notProcessed = newRows.length - processed;
    outcome.error = toAppError(failure, 'The import stopped unexpectedly.').message;
  }
  return outcome;
}

/** Appends the audit entry (server timestamp). No workbook content is stored. */
export async function recordImportHistory(
  db: Firestore,
  outcome: ImportOutcome,
  actor: ImportActor,
): Promise<void> {
  await addDoc(collection(db, COLLECTIONS.importHistory), {
    filename: outcome.filename.slice(0, 255),
    imported_by: actor.uid,
    imported_by_name: actor.name,
    imported_at: serverTimestamp(),
    total_rows: outcome.totalRows,
    new: outcome.created,
    skipped: outcome.skipped,
    conflicts: outcome.conflicts,
    duplicates: outcome.duplicates,
    invalid: outcome.invalid,
    status: outcome.status,
    ...(outcome.error ? { error: outcome.error.slice(0, 300) } : {}),
  });
}
