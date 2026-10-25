import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Backup and promotion tests wait out real settling times (several seconds each).
    testTimeout: 120_000,
    hookTimeout: 30_000,
    // Servers bind real ports and mDNS sockets: run test files one at a time.
    fileParallelism: false,
    // Keep test output readable; tests that check logging capture it themselves.
    env: { VICIMUS_LOG: 'silent' },
  },
});
