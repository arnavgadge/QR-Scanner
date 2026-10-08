/**
 * Firebase configuration read from Vite env variables (see .env.example).
 * Nothing is hard-coded. If values are missing the app shows a configuration screen
 * instead of crashing.
 *
 * Emulator mode (dev builds only): VITE_USE_FIREBASE_EMULATOR=true points Auth/Firestore at
 * the local emulators and fills harmless demo values for anything not set.
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

/** Never honoured in production builds. */
// Written with DIRECT `import.meta.env.DEV` references (not via an `env` alias) so the bundler can
// replace DEV with `false` in a production build and drop every emulator-only line below.
export const useEmulator: boolean =
  import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';

/** Harmless placeholder values for the emulators only (absent from production bundles). */
const demo: FirebaseConfig | null = useEmulator
  ? {
      apiKey: 'demo-api-key',
      authDomain: 'localhost',
      projectId: 'demo-vicimus',
      storageBucket: 'demo-vicimus.appspot.com',
      messagingSenderId: '0',
      appId: '1:0:web:demo',
    }
  : null;

const fromEnv: Record<keyof FirebaseConfig, { name: string; value: string | undefined }> = {
  apiKey: { name: 'VITE_FIREBASE_API_KEY', value: env.VITE_FIREBASE_API_KEY },
  authDomain: { name: 'VITE_FIREBASE_AUTH_DOMAIN', value: env.VITE_FIREBASE_AUTH_DOMAIN },
  projectId: { name: 'VITE_FIREBASE_PROJECT_ID', value: env.VITE_FIREBASE_PROJECT_ID },
  storageBucket: { name: 'VITE_FIREBASE_STORAGE_BUCKET', value: env.VITE_FIREBASE_STORAGE_BUCKET },
  messagingSenderId: {
    name: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
    value: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  },
  appId: { name: 'VITE_FIREBASE_APP_ID', value: env.VITE_FIREBASE_APP_ID },
};

const keys = Object.keys(fromEnv) as (keyof FirebaseConfig)[];
const present = (v: string | undefined): v is string => typeof v === 'string' && v.trim() !== '';

/** Names of required env variables that are unset (empty when emulator mode supplies defaults). */
export const missingFirebaseVars: string[] = useEmulator
  ? []
  : [
      ...keys.filter((k) => !present(fromEnv[k].value)).map((k) => fromEnv[k].name),
      // Fail closed: a "demo-" project id exists only for the local emulators. If it ever reaches a
      // build that is NOT running in emulator mode, refuse to start rather than talk to a wrong project.
      ...(/^demo-/i.test((fromEnv.projectId.value ?? '').trim())
        ? ['VITE_FIREBASE_PROJECT_ID (a "demo-" project id is only valid with the emulators)']
        : []),
    ];

export const isFirebaseConfigured: boolean = missingFirebaseVars.length === 0;

export const firebaseConfig: FirebaseConfig | null = isFirebaseConfigured
  ? (Object.fromEntries(
      keys.map((k) => {
        const v = fromEnv[k].value;
        return [k, present(v) ? v : (demo?.[k] ?? '')];
      }),
    ) as unknown as FirebaseConfig)
  : null;
