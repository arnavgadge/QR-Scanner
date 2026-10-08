import { doc, getDoc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { COLLECTIONS, getDb } from '../firebase/firestore';
import { parseUser } from '../firebase/converters';
import { toAppError, type AppError } from '../errors';
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

/**
 * Live view of the signed-in user's OWN profile (users/{uid}). Used so that an admin changing this
 * person's role or deactivating them takes effect in the open session immediately, instead of only
 * at the next page load. (Reading your own profile is allowed by the rules even when inactive,
 * precisely so the app can explain why access stopped.) Security never depends on this listener:
 * the Firestore rules re-check the profile on every read and write.
 */
export function subscribeToUserProfile(
  uid: string,
  onProfile: (user: User | null) => void,
  onError: (error: AppError) => void,
): Unsubscribe {
  return onSnapshot(
    doc(getDb(), COLLECTIONS.users, uid),
    (snap) => {
      try {
        onProfile(snap.exists() ? parseUser(snap.id, snap.data()) : null);
      } catch (e) {
        onError(toAppError(e, 'Unable to load your profile.'));
      }
    },
    (e) => onError(toAppError(e, 'Unable to load your profile.')),
  );
}
