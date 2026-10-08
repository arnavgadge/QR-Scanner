import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tests render a few React components to static markup (react-dom/server)
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // Emulator-backed tests share one Firestore emulator; run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
