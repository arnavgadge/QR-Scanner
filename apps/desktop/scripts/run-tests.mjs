// Runs the desktop test suite INSIDE ELECTRON'S RUNTIME (ELECTRON_RUN_AS_NODE), i.e. with the
// same Node version and TLS library (BoringSSL) as the real app. Plain Node uses OpenSSL, which
// accepts certificates Electron rejects: tests there once passed while the app failed.
// `npm test -- --node` runs the suite under plain Node instead.
import { spawnSync } from 'node:child_process';
import electron from 'electron';

const args = process.argv.slice(2);
const plainNode = args.includes('--node');
const rest = args.filter((a) => a !== '--node');
const runtime = plainNode ? process.execPath : electron;
const r = spawnSync(runtime, ['node_modules/vitest/vitest.mjs', 'run', ...rest], {
  stdio: 'inherit',
  env: { ...process.env, ...(plainNode ? {} : { ELECTRON_RUN_AS_NODE: '1' }) },
});
process.exit(r.status ?? 1);
