import type { Firestore } from 'firebase/firestore';
import { AppError } from '../errors';
import { normalizeSerial } from '../../utils/serial';
import type { Company, SerialRecord, SerialSource } from '../../types';
import { describeSerialFormat, labelCodeProblem, validateSerialFormat } from './serialFormat';
import { readScanLogTimestamp, registerOrDetectDuplicate } from './serialRepository';
import { serialValueProblem } from './serialValidation';

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
}

export interface DuplicateSerialResult {
  result: 'duplicate';
  serial: string;
  company: Company;
  /** The ORIGINAL registration, untouched. */
  existingRecord: SerialRecord;
  /** This attempt, as logged. */
  currentAttempt: { scannedBy: string; scannedByName: string; timestamp: string };
}

export interface InvalidSerialResult {
  result: 'invalid';
  serial: string;
  reason: 'empty' | 'no-company' | 'format' | 'characters' | 'length';
  message: string;
}

export interface VerificationErrorResult {
  result: 'error';
  code:
    | 'unauthenticated'
    | 'company-unavailable'
    | 'code-type-not-configured'
    | 'permission-denied'
    | 'unknown';
  message: string;
}

export type VerificationResult =
  NewSerialResult | DuplicateSerialResult | InvalidSerialResult | VerificationErrorResult;

const UNABLE = 'Unable to verify serial. Please try again.';

function failure(e: unknown): VerificationErrorResult {
  if (e instanceof AppError && e.code === 'permission-denied') {
    return {
      result: 'error',
      code: 'permission-denied',
      message: 'You do not have permission to register serials.',
    };
  }
  if (!(e instanceof AppError)) logError('Serial verification failed', e);
  return { result: 'error', code: 'unknown', message: UNABLE };
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
    return { result: 'invalid', serial, reason: 'empty', message: 'Enter a serial number.' };
  }
  if (!input.companyId) {
    return { result: 'invalid', serial, reason: 'no-company', message: 'Select a company.' };
  }

  let actor: Actor | null;
  let company: Company | null;
  try {
    actor = await deps.loadActor();
    if (!actor) {
      return {
        result: 'error',
        code: 'unauthenticated',
        message: 'Your session has expired. Please log in again.',
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
  if (!company || !company.active) {
    return {
      result: 'error',
      code: 'company-unavailable',
      message: 'Company configuration is unavailable. Contact an administrator.',
    };
  }

  // A company without a valid code type cannot produce a label, so nothing is registered for it:
  // otherwise a serial would be consumed with no way to label it. (Checked before any write.)
  if (company.codeType !== 'barcode' && company.codeType !== 'qr') {
    return {
      result: 'error',
      code: 'code-type-not-configured',
      message: 'Company code type is not configured. Contact an administrator.',
    };
  }

  if (!validateSerialFormat(serial, company.serialFormat)) {
    return {
      result: 'invalid',
      serial,
      reason: 'format',
      message: `Invalid serial format for ${company.name}. Expected: ${describeSerialFormat(company.serialFormat)}.`,
    };
  }

  // Shared value rules (length, storable as a document ID): identical for manual, OCR and Excel.
  const valueProblem = serialValueProblem(serial);
  if (valueProblem) {
    return {
      result: 'invalid',
      serial,
      reason: valueProblem.code === 'too-long' ? 'length' : 'characters',
      message: valueProblem.message,
    };
  }

  // A serial the company's label cannot encode must not be registered (it would be consumed with no
  // way to label it): same philosophy as the "code type not configured" check above.
  const codeProblem = labelCodeProblem(company.codeType, serial);
  if (codeProblem) {
    return {
      result: 'invalid',
      serial,
      reason: 'characters',
      message: `${codeProblem} It cannot be registered for ${company.name}.`,
    };
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
