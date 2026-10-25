// Phase 11: a production build must never carry emulator endpoints, demo config, mock OCR or test data,
// even if the build environment sets the dev-only flags by mistake.
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script (no types)
import { buildAndScan } from '../scripts/verify-prod-bundle.mjs';

describe('production bundle hygiene', () => {
  it('ignores VITE_USE_FIREBASE_EMULATOR / VITE_OCR_PROVIDER and ships no dev/test content', () => {
    const hits: string[] = buildAndScan();
    expect(hits).toEqual([]);
  }, 120_000);
});
