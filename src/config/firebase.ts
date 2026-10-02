/**
 * Firebase configuration read from Vite env variables (see .env.example).
 * Nothing is hard-coded. If any value is missing the app still runs, with Firebase disabled.
 */
export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

const env = import.meta.env;

const raw = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured: boolean = Object.values(raw).every(
  (v) => typeof v === 'string' && v.trim() !== '',
);

export const firebaseConfig: FirebaseConfig | null = isFirebaseConfigured
  ? (raw as FirebaseConfig)
  : null;
