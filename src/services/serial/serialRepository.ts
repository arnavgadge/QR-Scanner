import { doc, getDoc, type DocumentReference } from 'firebase/firestore';
import { COLLECTIONS, getDb } from '../firebase/firestore';
import { parseSerial } from '../firebase/converters';
import { AppError, toAppError } from '../errors';
import type { SerialRecord } from '../../types';

/**
 * Data boundary for serials/{serial}. The serial IS the document ID, so uniqueness checks are
 * direct document operations — never a collection query or a locally cached list.
 *
 * Phase 3 adds the atomic create-if-not-exists registration here (Firestore transaction +
 * scan_log write). It is intentionally NOT implemented in Phase 2.
 */

/** Firestore IDs cannot be empty, '.', '..' or contain '/'. */
export function serialDocRef(serial: string): DocumentReference {
  if (!serial || serial === '.' || serial === '..' || serial.includes('/')) {
    throw new AppError(
      'invalid-data',
      'This serial number contains characters that are not allowed.',
    );
  }
  return doc(getDb(), COLLECTIONS.serials, serial);
}

/** Direct lookup of one serial (a single document read). Expects an already-normalized serial. */
export async function getSerial(serial: string): Promise<SerialRecord | null> {
  try {
    const snap = await getDoc(serialDocRef(serial));
    return snap.exists() ? parseSerial(snap.id, snap.data()) : null;
  } catch (e) {
    throw toAppError(e, 'Unable to look up the serial number.');
  }
}
