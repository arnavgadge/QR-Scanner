import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type Unsubscribe,
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { AppError, toAppError } from '../errors';
import { getFirebase } from './client';

/** Minimal identity from Firebase Auth. Role/active status come from users/{uid}, never from here. */
export interface AuthIdentity {
  uid: string;
  email: string | null;
}

/** The only auth state listener in the app (used by AuthProvider). */
export function subscribeToAuth(
  onChange: (identity: AuthIdentity | null) => void,
  onError: (error: AppError) => void,
): Unsubscribe {
  try {
    return onAuthStateChanged(
      getFirebase().auth,
      (u) => onChange(u ? { uid: u.uid, email: u.email } : null),
      (e) =>
        onError(
          toAppError(
            e,
            'Unable to check your sign-in. Check your connection, then reload and sign in again.',
          ),
        ),
    );
  } catch (e) {
    // Initialization failure: report asynchronously so callers can treat it like any auth error.
    const error = toAppError(
      e,
      'Unable to start the sign-in service. Reload the page; if it keeps happening, contact an administrator.',
    );
    queueMicrotask(() => onError(error));
    return () => undefined;
  }
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  try {
    await signInWithEmailAndPassword(getFirebase().auth, email.trim(), password);
  } catch (e) {
    if (e instanceof FirebaseError) {
      switch (e.code) {
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
        case 'auth/user-not-found':
        case 'auth/invalid-email':
          throw new AppError('invalid-credentials', 'Invalid email or password.', { cause: e });
        case 'auth/network-request-failed':
          throw new AppError(
            'network',
            'Unable to connect. Check your internet connection and try again.',
            { cause: e },
          );
        case 'auth/too-many-requests':
          throw new AppError('unknown', 'Too many failed attempts. Please wait and try again.', {
            cause: e,
          });
        case 'auth/user-disabled':
          throw new AppError(
            'permission-denied',
            'This account is disabled. Contact an administrator.',
            {
              cause: e,
            },
          );
      }
    }
    throw toAppError(e, 'Unable to sign in. Please try again.');
  }
}

export async function signOutUser(): Promise<void> {
  await signOut(getFirebase().auth);
}
