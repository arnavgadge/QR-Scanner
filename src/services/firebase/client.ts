import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { firebaseConfig, useEmulator } from '../../config/firebase';
import { AppError } from '../errors';

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let services: FirebaseServices | null = null;

/**
 * Email/password only, so no popup/redirect resolver: this avoids loading Firebase's
 * auth-domain iframe at start-up. Sessions persist across refreshes (IndexedDB, falling back
 * to localStorage); Firebase stores a token, never the password.
 */
function createAuth(app: FirebaseApp): Auth {
  try {
    return initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    });
  } catch {
    return getAuth(app); // already initialized (hot module reload)
  }
}

/**
 * The single Firebase initialization point: app -> auth -> firestore.
 * Every service uses these instances; components must not initialize Firebase themselves.
 */
export function getFirebase(): FirebaseServices {
  if (services) return services;
  if (!firebaseConfig) {
    throw new AppError('config', 'Firebase is not configured. Check the environment variables.');
  }
  const app = getApps()[0] ?? initializeApp(firebaseConfig);
  const auth = createAuth(app);
  const db = getFirestore(app);
  if (useEmulator) {
    try {
      // 127.0.0.1, not "localhost": the emulators bind IPv4, and "localhost" can resolve to
      // IPv6 where another local service may be listening on the same port.
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
    } catch {
      // Already connected (hot module reload).
    }
  }
  services = { app, auth, db };
  return services;
}
