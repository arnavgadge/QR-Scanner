import { missingFirebaseVars } from '../config/firebase';

/** Shown instead of the app when Firebase environment variables are not set. */
export function ConfigMissingScreen() {
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <div role="alert" className="rounded-lg border border-danger bg-danger-soft p-6">
        <h1 className="text-2xl font-bold text-danger">Firebase is not configured</h1>
        <p className="mt-2">
          Copy <code className="font-mono">.env.example</code> to{' '}
          <code className="font-mono">.env.local</code>, fill in your Firebase web app values, and
          restart the dev server. To work fully locally instead, set{' '}
          <code className="font-mono">VITE_USE_FIREBASE_EMULATOR=true</code> and run{' '}
          <code className="font-mono">npm run emulators</code>.
        </p>
        <p className="mt-3 font-semibold">Missing variables:</p>
        <ul className="mt-1 list-disc pl-5 font-mono text-sm">
          {missingFirebaseVars.map((v) => (
            <li key={v}>{v}</li>
          ))}
        </ul>
      </div>
    </main>
  );
}
