// Bundles the Electron main process and preload script (TypeScript, plus the shared pure modules
// from ../web/src) into build/. Native and Electron modules stay external.
import { copyFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  // Shared modules from the web app read Vite's import.meta.env; in the main process it is a
  // production build with no overrides (label size etc. fall back to their defaults).
  define: { 'import.meta.env': JSON.stringify({ DEV: false, PROD: true, MODE: 'production' }) },
  external: ['electron', 'better-sqlite3', 'bufferutil', 'utf-8-validate'],
};

await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'build/main/main.cjs' });
await build({
  ...common,
  entryPoints: ['src/preload/preload.ts'],
  outfile: 'build/main/preload.cjs',
});

mkdirSync('build', { recursive: true });
copyFileSync('build-resources/icon.png', 'build/icon.png');
