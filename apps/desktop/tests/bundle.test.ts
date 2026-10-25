// The desktop main process (server + station) must not contain Firebase or any web-only backend.
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('desktop main-process bundle', () => {
  it('includes no Firebase code (the desktop never talks to the internet)', async () => {
    const result = await build({
      entryPoints: ['src/main/main.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      write: false,
      metafile: true,
      logLevel: 'silent',
      external: ['electron', 'better-sqlite3', 'bufferutil', 'utf-8-validate'],
      define: { 'import.meta.env': JSON.stringify({ DEV: false, PROD: true }) },
    });
    const inputs = Object.keys(result.metafile!.inputs);
    expect(inputs.filter((p) => /firebase|services\/firebase|serialRepository/.test(p))).toEqual(
      [],
    );
    expect(inputs.some((p) => p.includes('src/server/server.ts'))).toBe(true);
  });
});
