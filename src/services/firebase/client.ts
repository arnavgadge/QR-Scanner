import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { firebaseConfig } from '../../config/firebase';

/** Returns the Firebase app, or null when env configuration is absent (Phase 0 default). */
export function getFirebaseApp(): FirebaseApp | null {
  if (!firebaseConfig) return null;
  return getApps()[0] ?? initializeApp(firebaseConfig);
}
