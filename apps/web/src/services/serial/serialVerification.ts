import type { Firestore } from 'firebase/firestore';
import { enText, msg, type Msg } from '../../i18n/core';
import { AppError } from '../errors';
import { normalizeSerial } from '../../utils/serial';
import type { Company, SerialRecord, SerialSource } from '../../types';
import { readScanLogTimestamp, registerOrDetectDuplicate } from './serialRepository';
import { checkSerialForCompany } from './serialChecks';

import { logError } from '../../utils/log';
/** The authenticated operator, derived from Firebase Auth + users/{uid} (never from the UI). */
export interface Actor {
  uid: string;
  name: string;
}

export interface VerifyInput {
  serial: string;
  companyId: string;
  partNo?: string;
  source: SerialSource;
}

/** Everything the verification needs from the outside world, injectable for tests. */
export interface VerifyDeps {
  db: Firestore;
  loadActor: () => Promise<Actor | null>;
  loadCompany: (companyId: string) => Promise<Company | null>;
}

export interface NewSerialResult {
  result: 'new';
  serial: string;
  company: Company;
  partNo: string;
  source: SerialSource;
  scannedBy: string;
  scannedByName: string;
  /** Server timestamp (ISO). Falls back to local time only if the read-back failed. */
  scannedAt: string;
  /** Station (computer) it was registered on; desktop server only. */
  nodeName?: string;
}

export interface DuplicateSerialResult {
  result: 'duplicate';
  serial: string;
  company: Company;
  /** The ORIGINAL registration, untouched. */
  existingRecord: SerialRecord;
  /** This attempt, as logged. */
  currentAttempt: {
    scannedBy: string;
    scannedByName: string;
    timestamp: string;
    nodeName?: string;
  };
}

export interface InvalidSerialResult {
  result: 'invalid';
  serial: string;
  reason: 'empty' | 'no-company' | 'format' | 'characters' | 'length';
  /** English text (logs, tests). */
  message: string;
  /** The same message, translated by the UI. */
  msg: Msg;
}

export interface VerificationErrorResult {
  result: 'error';
  code:
    | 'unauthenticated'
    | 'company-unavailable'
    | 'code-type-not-configured'
    | 'permission-denied'
    /** Desktop: the main computer cannot be reached, so nothing can be checked or registered. */
    | 'server-unreachable'
    /** Desktop: this computer runs a different app version than the main computer. */
    | 'update-required'
    /** Desktop: the main computer cannot reach the other computers, so registering is paused. */
    | 'paused'
    /** Desktop: a backup was made the main computer; this computer no longer registers. */
    | 'not-main'
    | 'unknown';
  /** English text (logs, tests). */
  message: string;
  /** The same message, translated by the UI. */
  msg: Msg;
}

export type VerificationResult =
  NewSerialResult | DuplicateSerialResult | InvalidSerialResult | VerificationErrorResult;

/** `message` (English) and `msg` (translatable) for a result. */
const text = (m: Msg) => ({ message: enText(m), msg: m });

function failure(e: unknown): VerificationErrorResult {
  if (e instanceof AppError && e.code === 'permission-denied') {
    return { result: 'error', code: 'permission-denied', ...text(msg('verify.noPermission')) };
  }
  if (!(e instanceof AppError)) logError('Serial verification failed', e);
  return { result: 'error', code: 'unknown', ...text(msg('verify.unable')) };
}

/**
 * Normalize -> validate against the company's format -> atomic Firestore registration.
 * Never reports 'new' or 'duplicate' unless the Firestore transaction actually committed.
 */
export async function verifySerial(
  deps: VerifyDeps,
  input: VerifyInput,
): Promise<VerificationResult> {
  const serial = normalizeSerial(input.serial);
  if (!serial) {
    return { result: 'invalid', serial, reason: 'empty', ...text(msg('verify.empty')) };
  }
  if (!input.companyId) {
    return { result: 'invalid', serial, reason: 'no-company', ...text(msg('verify.noCompany')) };
  }

  let actor: Actor | null;
  let company: Company | null;
  try {
    actor = await deps.loadActor();
    if (!actor) {
      return {
        result: 'error',
        code: 'unauthenticated',
        ...text(msg('auth.sessionExpired')),
      };
    }
    try {
      company = await deps.loadCompany(input.companyId);
    } catch (e) {
      // Operators can only read ACTIVE companies (security rules), so a company an admin has just
      // deactivated (or removed) answers permission-denied: that means "unavailable", not that the
      // operator lacks permission to register serials.
      if (e instanceof AppError && e.code === 'permission-denied') company = null;
      else throw e;
    }
  } catch (e) {
    return failure(e);
  }
  const refused = checkSerialForCompany(serial, company);
  if (refused || !company) {
    return (
      refused ?? {
        result: 'error',
        code: 'company-unavailable',
        ...text(msg('verify.companyUnavailable')),
      }
    );
  }

  const partNo = input.partNo?.trim() ?? '';
  let outcome;
  try {
    outcome = await registerOrDetectDuplicate(deps.db, {
      serial,
      partNo,
      company: { id: company.id, name: company.name },
      source: input.source,
      actor,
    });
  } catch (e) {
    return failure(e);
  }

  // The transaction has committed. From here on, never downgrade the outcome to an error.
  let timestamp: string | null = null;
  try {
    timestamp = await readScanLogTimestamp(deps.db, outcome.logId);
  } catch {
    // Display-only fallback below.
  }
  const when = timestamp ?? new Date().toISOString();

  if (outcome.result === 'duplicate' && outcome.existing) {
    return {
      result: 'duplicate',
      serial,
      company,
      existingRecord: outcome.existing,
      currentAttempt: { scannedBy: actor.uid, scannedByName: actor.name, timestamp: when },
    };
  }
  return {
    result: 'new',
    serial,
    company,
    partNo,
    source: input.source,
    scannedBy: actor.uid,
    scannedByName: actor.name,
    scannedAt: when,
  };
}

export { checkSerialForCompany } from './serialChecks';
