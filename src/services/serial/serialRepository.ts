import { FirebaseError } from 'firebase/app';
import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import { COLLECTIONS, getDb } from '../firebase/firestore';
import { parseSerial } from '../firebase/converters';
import { AppError, toAppError } from '../errors';
import { serialIdProblem } from './serialValidation';
import type { SerialRecord, SerialSource } from '../../types';

/**
 * Data boundary for serials/{serial}.
 *
 * UNIQUENESS SCOPE: the serial IS the document ID, so a serial is globally unique across all
 * companies. This is the single place that encodes that decision; to make serials unique per
 * company later, change `serialDocId` (e.g. `${companyId}__${serial}`) and the rules together.
 */

export function serialDocId(serial: string): string {
  const problem = serialIdProblem(serial);
  if (problem) throw new AppError('invalid-data', problem);
  return serial;
}

export function serialDocRef(db: Firestore, serial: string): DocumentReference {
  return doc(db, COLLECTIONS.serials, serialDocId(serial));
}

/** Direct lookup of one serial (a single document read). Expects an already-normalized serial. */
export async function getSerial(serial: string): Promise<SerialRecord | null> {
  try {
    const snap = await getDoc(serialDocRef(getDb(), serial));
    return snap.exists() ? parseSerial(snap.id, snap.data()) : null;
  } catch (e) {
    throw toAppError(e, 'Unable to look up the serial number.');
  }
}

export interface RegisterParams {
  serial: string;
  partNo: string;
  company: { id: string; name: string };
  source: SerialSource;
  actor: { uid: string; name: string };
}

export interface RegistrationOutcome {
  result: 'new' | 'duplicate';
  /** The record that already existed (duplicate only), exactly as stored. */
  existing: SerialRecord | null;
  /** The scan_log document written by this attempt. */
  logId: string;
}

/** Builds a displayable record even if a stored document is incomplete. */
function toExistingRecord(id: string, data: Record<string, unknown>): SerialRecord {
  try {
    return parseSerial(id, data);
  } catch {
    const s = (k: string) => (typeof data[k] === 'string' ? (data[k] as string) : 'Unknown');
    return {
      serial: id,
      partNo: typeof data.part_no === 'string' ? data.part_no : '',
      company: s('company'),
      companyId: s('company_id'),
      source: 'manual',
      scannedAt: null,
      scannedBy: s('scanned_by'),
      scannedByName: s('scanned_by_name'),
    };
  }
}

/**
 * ATOMIC create-if-not-exists. One Firestore transaction reads serials/{serial} and, in the
 * same commit, either writes the serial + a 'new' scan_log entry, or only a 'duplicate'
 * scan_log entry. Concurrent submissions of the same serial contend on that document;
 * Firestore retries the loser, which then sees the winner's record and reports duplicate.
 * There is no separate check-then-write step anywhere.
 *
 * Timestamps are server timestamps. The existing record is never modified.
 */
export async function registerOrDetectDuplicate(
  db: Firestore,
  p: RegisterParams,
): Promise<RegistrationOutcome> {
  const serialRef = serialDocRef(db, p.serial);
  const logRef = doc(collection(db, COLLECTIONS.scanLog));

  const attempt = {
    serial: p.serial,
    company: p.company.name,
    company_id: p.company.id,
    source: p.source,
    scanned_by: p.actor.uid,
    scanned_by_name: p.actor.name,
  };

  const run = () =>
    runTransaction(db, async (tx) => {
      const snap = await tx.get(serialRef);
      if (snap.exists()) {
        tx.set(logRef, { ...attempt, result: 'duplicate', timestamp: serverTimestamp() });
        return toExistingRecord(snap.id, snap.data());
      }
      tx.set(serialRef, {
        serial: p.serial,
        part_no: p.partNo,
        company: p.company.name,
        company_id: p.company.id,
        source: p.source,
        scanned_at: serverTimestamp(),
        scanned_by: p.actor.uid,
        scanned_by_name: p.actor.name,
      });
      tx.set(logRef, { ...attempt, result: 'new', timestamp: serverTimestamp() });
      return null;
    });

  // Losing a race: the loser read "serial missing" and tries to create it, but by commit time the
  // winner's document exists, so the create is evaluated as an update and the security rules
  // reject it (permission-denied) before Firestore's own contention retry can happen. Re-running
  // the transaction is correct and safe: it now reads the winner's record and takes the
  // 'duplicate' path. A genuine permission problem fails every attempt and is reported as such.
  for (let attemptNo = 1; ; attemptNo++) {
    try {
      const existing = await run();
      return { result: existing ? 'duplicate' : 'new', existing, logId: logRef.id };
    } catch (e) {
      const retryable =
        e instanceof FirebaseError &&
        (e.code === 'permission-denied' ||
          e.code === 'aborted' ||
          e.code === 'failed-precondition');
      if (!retryable || attemptNo >= MAX_ATTEMPTS) throw e;
    }
  }
}

const MAX_ATTEMPTS = 3;

/** Reads back the authoritative server timestamp of a scan_log entry (null if unavailable). */
export async function readScanLogTimestamp(db: Firestore, logId: string): Promise<string | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.scanLog, logId));
  const ts: unknown = snap.data()?.timestamp;
  return ts && typeof (ts as { toDate?: unknown }).toDate === 'function'
    ? (ts as { toDate: () => Date }).toDate().toISOString()
    : null;
}
