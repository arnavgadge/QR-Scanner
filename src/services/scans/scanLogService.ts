import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { COLLECTIONS, getDb } from '../firebase/firestore';
import { parseScanLog } from '../firebase/converters';
import { toAppError } from '../errors';
import type { ScanLog } from '../../types';

import { logWarn } from '../../utils/log';
const MAX_RECENT = 50;

/**
 * Most recent scan attempts, newest first. Always limited (never the whole collection).
 * Writing scan_log entries is added in Phase 3 together with serial registration.
 */
export async function getRecentScans(count = 20): Promise<ScanLog[]> {
  const n = Math.min(Math.max(Math.trunc(count), 1), MAX_RECENT);
  try {
    const snap = await getDocs(
      query(collection(getDb(), COLLECTIONS.scanLog), orderBy('timestamp', 'desc'), limit(n)),
    );
    const scans: ScanLog[] = [];
    for (const d of snap.docs) {
      try {
        scans.push(parseScanLog(d.id, d.data()));
      } catch (e) {
        logWarn('Skipping malformed scan_log document', d.id, e);
      }
    }
    return scans;
  } catch (e) {
    throw toAppError(e, 'Unable to load recent scans.');
  }
}
