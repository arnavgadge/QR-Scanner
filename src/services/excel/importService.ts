import type { Firestore } from 'firebase/firestore';
import { AppError, toAppError } from '../errors';
import { getFirebase } from '../firebase/client';
import { currentAdmin } from '../users/currentAdmin';
import { fetchAllCompanies } from './exportData';
import { classifyAgainstFirestore, countRows, normalizeRows } from './importClassify';
import { executeImport, recordImportHistory, type ImportActor } from './importExecute';
import { lookupExistingSerials } from './importLookup';
import { parseImportFile } from './importParser';
import type { ImportOutcome, ImportPreview } from './importTypes';

import { logError } from '../../utils/log';
/**
 * Preview: parse locally -> normalize/validate -> detect in-file duplicates -> compare with
 * Firestore by direct document-ID lookups. Performs NO writes.
 */
export async function previewImport(
  db: Firestore,
  data: ArrayBuffer | Uint8Array,
  filename: string,
  onProgress?: (checked: number, total: number) => void,
): Promise<ImportPreview> {
  const parsed = await parseImportFile(data, filename); // throws before any Firestore access
  try {
    const companies = await fetchAllCompanies(db);
    const normalized = normalizeRows(parsed.rows, companies);
    const existing = await lookupExistingSerials(db, normalized.serialsToCheck, onProgress);
    const rows = classifyAgainstFirestore(normalized, existing);
    return {
      filename,
      sheetName: parsed.sheetName,
      sheets: parsed.sheets,
      rows,
      counts: countRows(rows),
    };
  } catch (e) {
    const err = toAppError(e, 'Unable to check the file against Firestore. Please try again.');
    throw err.code === 'permission-denied'
      ? new AppError('permission-denied', 'You do not have permission to import serial data.', {
          cause: e,
        })
      : err;
  }
}

export interface ConfirmResult {
  outcome: ImportOutcome;
  /** False if the import ran but its history entry could not be saved. */
  historyRecorded: boolean;
}

/** Confirm: create the NEW rows safely, then append the import-history entry. */
export async function confirmImport(
  db: Firestore,
  preview: ImportPreview,
  actor: ImportActor,
  onProgress?: (done: number, total: number) => void,
): Promise<ConfirmResult> {
  const outcome = await executeImport(db, preview, actor, onProgress);
  let historyRecorded = true;
  try {
    await recordImportHistory(db, outcome, actor);
  } catch (e) {
    historyRecorded = false;
    logError('Could not record import history', e);
  }
  return { outcome, historyRecorded };
}

/** Production entry points used by the UI. */
export async function previewImportFile(
  file: File,
  onProgress?: (checked: number, total: number) => void,
): Promise<ImportPreview> {
  await currentAdmin();
  return previewImport(getFirebase().db, await file.arrayBuffer(), file.name, onProgress);
}

export async function confirmImportPreview(
  preview: ImportPreview,
  onProgress?: (done: number, total: number) => void,
): Promise<ConfirmResult> {
  const actor = await currentAdmin();
  return confirmImport(getFirebase().db, preview, actor, onProgress);
}
