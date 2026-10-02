import { getFirestore, type Firestore } from 'firebase/firestore';
import { getFirebaseApp } from './client';

/** Firestore instance, or null if Firebase is not configured. Queries arrive in Phase 2+. */
export function getDb(): Firestore | null {
  const app = getFirebaseApp();
  return app ? getFirestore(app) : null;
}
