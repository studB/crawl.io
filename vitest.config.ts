import { defineConfig } from 'vitest/config';

/**
 * Unit tests and integration tests both run under `npx vitest run`.
 *
 *   - `*.test.ts`             — pure unit tests (browser-free), colocated under `src/`.
 *   - `*.integration.test.ts` — drive real Chromium against local HTML fixtures served via
 *                               `file://` URLs.
 *
 * The 60s timeout gives integration tests headroom for a cold Chromium start (WSL can spend
 * several seconds on the first launch). Unit tests execute in milliseconds and won't notice.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.integration.test.ts'],
    environment: 'node',
    passWithNoTests: true,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Shim: on Linux hosts lacking system NSS/NSPR/ALSA libs, probe a repo-
    // local staging dir and extend LD_LIBRARY_PATH. No-op on well-provisioned
    // hosts (CI with `playwright install-deps`, typical dev workstations).
    setupFiles: ['test/setup/playwright-env.ts'],
  },
});
