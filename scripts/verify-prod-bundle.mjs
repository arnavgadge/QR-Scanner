// Builds the app the way a hostile/mistaken environment would (emulator + mock-OCR flags ON, fake
// production Firebase values) and fails if anything emulator/dev/test related reached the bundle.
// Usage: npm run verify:bundle        (used by tests/productionBundle.test.ts too)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN = [
  '127.0.0.1',
  'localhost:8080',
  '9099',
  'demo-vicimus',
  'demo-api-key',
  'devpassword',
  'example.test',
  'mock-high',
  'DEVELOPMENT: using',
  'seed-dev',
  'connectAuthEmulator(',
];

const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

export function buildAndScan() {
  const out = mkdtempSync(join(tmpdir(), 'vicimus-bundle-'));
  try {
    execFileSync(
      process.execPath,
      ['node_modules/vite/bin/vite.js', 'build', '--outDir', out, '--emptyOutDir'],
      {
        stdio: 'pipe',
        env: {
          ...process.env,
          NODE_ENV: 'production', // a stray NODE_ENV (e.g. 'test' under vitest) must not change what ships
          VITE_USE_FIREBASE_EMULATOR: 'true', // must be IGNORED by a production build
          VITE_OCR_PROVIDER: 'mock', // must be IGNORED by a production build
          VITE_FIREBASE_API_KEY: 'AIzaSyFakeKeyForBundleCheck',
          VITE_FIREBASE_AUTH_DOMAIN: 'bundle-check.firebaseapp.com',
          VITE_FIREBASE_PROJECT_ID: 'bundle-check',
          VITE_FIREBASE_STORAGE_BUCKET: 'bundle-check.appspot.com',
          VITE_FIREBASE_MESSAGING_SENDER_ID: '1',
          VITE_FIREBASE_APP_ID: '1:1:web:bundlecheck',
        },
      },
    );
    const hits = [];
    for (const f of walk(out).filter((p) => /\.(js|css|html|map)$/.test(p))) {
      const text = readFileSync(f, 'utf8');
      for (const bad of FORBIDDEN)
        if (text.includes(bad)) hits.push(`${bad}  in  ${f.replace(out, 'dist')}`);
    }
    return hits;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const hits = buildAndScan();
  if (hits.length) {
    console.error('Production bundle contains development/emulator content:\n' + hits.join('\n'));
    process.exit(1);
  }
  console.log(
    'OK: production bundle has no emulator endpoints, demo config, mock OCR, seed data or test accounts.',
  );
}
