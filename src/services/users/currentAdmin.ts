import { AppError } from '../errors';
import { getFirebase } from '../firebase/client';
import { getUserProfile } from './userService';

/** The signed-in admin (identity used for attribution of admin actions). */
export interface AdminActor {
  uid: string;
  name: string;
}

/**
 * Derives the acting admin from Firebase Auth + the stored profile (never from the UI). Throws if
 * the session is gone, the profile is inactive, or the user is not an admin. The Firestore rules
 * enforce the same thing independently; this only gives a clear message earlier.
 */
export async function currentAdmin(): Promise<AdminActor> {
  const { auth } = getFirebase();
  const current = auth.currentUser;
  const profile = current ? await getUserProfile(current.uid) : null;
  if (!profile || !profile.active) {
    throw new AppError('permission-denied', 'Your session has expired. Please log in again.');
  }
  if (profile.role !== 'admin') {
    throw new AppError('permission-denied', 'You do not have permission to do this.');
  }
  return { uid: profile.uid, name: profile.name };
}
