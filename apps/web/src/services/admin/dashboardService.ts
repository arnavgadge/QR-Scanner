import {
  collection,
  getCountFromServer,
  query,
  Timestamp,
  where,
  type Firestore,
  type QueryConstraint,
} from 'firebase/firestore';
import { COLLECTIONS, getDb } from '../firebase/firestore';
import { toAppError } from '../errors';

import { msg } from '../../i18n/core';
/**
 * Dashboard numbers. Every value is a Firestore COUNT aggregation (the server counts; no
 * documents are downloaded) over the real collections. Nothing is estimated or invented: if a
 * count fails, that metric is reported as unavailable by the caller.
 */
async function count(
  db: Firestore,
  name: string,
  ...constraints: QueryConstraint[]
): Promise<number> {
  try {
    const snap = await getCountFromServer(query(collection(db, name), ...constraints));
    return snap.data().count;
  } catch (e) {
    throw toAppError(e, msg('dashboard.metricFailed'));
  }
}

/** One document in `serials` = one registered serial (scan_log entries are NOT serials). */
export const countSerials = (db: Firestore = getDb()) => count(db, COLLECTIONS.serials);

/** Serials whose registration time falls in [start, end) (all sources, imports included). */
export const countSerialsRegisteredBetween = (start: Date, end: Date, db: Firestore = getDb()) =>
  count(
    db,
    COLLECTIONS.serials,
    where('scanned_at', '>=', Timestamp.fromDate(start)),
    where('scanned_at', '<', Timestamp.fromDate(end)),
  );

/** Duplicate scan ATTEMPTS (scan_log result = duplicate) in [start, end): not unique serials. */
export const countDuplicateAttemptsBetween = (start: Date, end: Date, db: Firestore = getDb()) =>
  count(
    db,
    COLLECTIONS.scanLog,
    where('result', '==', 'duplicate'),
    where('timestamp', '>=', Timestamp.fromDate(start)),
    where('timestamp', '<', Timestamp.fromDate(end)),
  );

export const countCompanies = (db: Firestore = getDb()) => count(db, COLLECTIONS.companies);

export const countActiveCompanies = (db: Firestore = getDb()) =>
  count(db, COLLECTIONS.companies, where('active', '==', true));

/** Operator ACCOUNTS that are active (not "currently online": the app does not track presence). */
export const countActiveOperators = (db: Firestore = getDb()) =>
  count(db, COLLECTIONS.users, where('role', '==', 'operator'), where('active', '==', true));

/** Registered serials per company (one count query per company; there are only a few). */
export const countSerialsForCompany = (companyId: string, db: Firestore = getDb()) =>
  count(db, COLLECTIONS.serials, where('company_id', '==', companyId));
