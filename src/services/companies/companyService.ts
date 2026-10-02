import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { COLLECTIONS, getDb } from '../firebase/firestore';
import { parseCompany } from '../firebase/converters';
import { toAppError } from '../errors';
import type { Company } from '../../types';

const MSG = 'Unable to load company configuration.';

/** One read of all active companies (a handful of documents), sorted by name. */
export async function getActiveCompanies(): Promise<Company[]> {
  try {
    const snap = await getDocs(
      query(collection(getDb(), COLLECTIONS.companies), where('active', '==', true)),
    );
    const companies: Company[] = [];
    for (const d of snap.docs) {
      try {
        companies.push(parseCompany(d.id, d.data()));
      } catch (e) {
        console.warn('Skipping malformed company document', d.id, e);
      }
    }
    return companies.sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    throw toAppError(e, MSG);
  }
}

export async function getCompany(companyId: string): Promise<Company | null> {
  try {
    const snap = await getDoc(doc(getDb(), COLLECTIONS.companies, companyId));
    return snap.exists() ? parseCompany(snap.id, snap.data()) : null;
  } catch (e) {
    throw toAppError(e, MSG);
  }
}
