import {
  doc,
  getDoc,
  getDocsFromServer,
  collection,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { COLLECTIONS, getDb } from '../firebase/firestore';
import { parseCompany } from '../firebase/converters';
import { AppError, toAppError } from '../errors';
import type { AdminActor } from '../users/currentAdmin';
import type { Company } from '../../types';
import { companyIdFromName, validateCompanyInput, type CompanyInput } from './companyValidation';

import { logWarn } from '../../utils/log';
import { msg } from '../../i18n/core';
/** Admin: every company (including inactive and "not configured" ones), straight from the server. */
export async function getAllCompanies(db: Firestore = getDb()): Promise<Company[]> {
  try {
    const snap = await getDocsFromServer(collection(db, COLLECTIONS.companies));
    const companies: Company[] = [];
    for (const d of snap.docs) {
      try {
        companies.push(parseCompany(d.id, d.data()));
      } catch (e) {
        logWarn('Skipping malformed company document', d.id, e);
      }
    }
    return companies.sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    throw toAppError(e, msg('companies.loadAllFailed'));
  }
}

function invalid(input: CompanyInput): AppError | null {
  const errors = validateCompanyInput(input);
  const first = Object.values(errors)[0];
  return first ? new AppError('invalid-data', first) : null;
}

/**
 * Admin: creates a company. Fails if the ID (derived from the name) is already taken, so an
 * existing company is never overwritten. Attributed to the acting admin; server timestamps.
 */
export async function createCompany(
  input: CompanyInput,
  actor: AdminActor,
  db: Firestore = getDb(),
): Promise<string> {
  const problem = invalid(input);
  if (problem) throw problem;
  const id = companyIdFromName(input.name);
  if (!id) throw new AppError('invalid-data', msg('companies.idInvalid'));
  try {
    const ref = doc(db, COLLECTIONS.companies, id);
    if ((await getDoc(ref)).exists()) {
      throw new AppError('invalid-data', msg('companies.idExists', { id }));
    }
    await setDoc(ref, {
      id,
      name: input.name.trim(),
      code_type: input.codeType,
      serial_format: input.serialFormat.trim(),
      active: input.active,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      created_by: actor.uid,
      updated_by: actor.uid,
      updated_by_name: actor.name,
    });
    return id;
  } catch (e) {
    throw toAppError(e, msg('companies.createFailed'));
  }
}

/**
 * Admin: updates a company's configuration (name, code type, serial format, active). Only
 * FUTURE registrations and labels are affected: serial records already stored (and their
 * scan history) are never touched. Companies are deactivated (active = false), never deleted.
 */
export async function updateCompany(
  companyId: string,
  input: CompanyInput,
  actor: AdminActor,
  db: Firestore = getDb(),
): Promise<void> {
  const problem = invalid(input);
  if (problem) throw problem;
  try {
    await updateDoc(doc(db, COLLECTIONS.companies, companyId), {
      name: input.name.trim(),
      code_type: input.codeType,
      serial_format: input.serialFormat.trim(),
      active: input.active,
      updated_at: serverTimestamp(),
      updated_by: actor.uid,
      updated_by_name: actor.name,
    });
  } catch (e) {
    throw toAppError(e, msg('companies.saveFailed'));
  }
}
