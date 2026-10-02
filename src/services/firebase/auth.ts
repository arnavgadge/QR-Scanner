import { getAuth, type Auth } from 'firebase/auth';
import { getFirebaseApp } from './client';

/** Firebase Auth instance, or null if Firebase is not configured. Sign-in arrives in Phase 2. */
export function getFirebaseAuth(): Auth | null {
  const app = getFirebaseApp();
  return app ? getAuth(app) : null;
}
