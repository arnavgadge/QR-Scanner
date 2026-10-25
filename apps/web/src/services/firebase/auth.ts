import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type Unsubscribe,
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { AppError, toAppError } from '../errors';
import { getFirebase } from './client';

import { msg } from '../../i18n/core';
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
      (e) => onError(toAppError(e, msg('auth.checkFailed'))),
    );
  } catch (e) {
    // Initialization failure: report asynchronously so callers can treat it like any auth error.
    const error = toAppError(e, msg('auth.startFailed'));
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
          throw new AppError('invalid-credentials', msg('auth.invalidCredentials'), { cause: e });
        case 'auth/network-request-failed':
          throw new AppError('network', msg('auth.noConnection'), { cause: e });
        case 'auth/too-many-requests':
          throw new AppError('unknown', msg('auth.tooManyAttempts'), {
            cause: e,
          });
        case 'auth/user-disabled':
          throw new AppError('permission-denied', msg('auth.disabled'), {
            cause: e,
          });
      }
    }
    throw toAppError(e, msg('auth.signInFailed'));
  }
}

export async function signOutUser(): Promise<void> {
  await signOut(getFirebase().auth);
}
