import { doc, getDoc } from 'firebase/firestore';
import { COLLECTIONS, getDb } from '../firebase/firestore';
import { parseUser } from '../firebase/converters';
import { toAppError } from '../errors';
import type { User } from '../../types';

/** Loads users/{uid}. Returns null if the account has no profile document. */
export async function getUserProfile(uid: string): Promise<User | null> {
  try {
    const snap = await getDoc(doc(getDb(), COLLECTIONS.users, uid));
    return snap.exists() ? parseUser(snap.id, snap.data()) : null;
  } catch (e) {
    throw toAppError(e, 'Unable to load your profile.');
  }
}
