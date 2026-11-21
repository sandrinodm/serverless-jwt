import { defineProject } from 'vite-plus';

/**
 * Bounds ordinary unit tests and hooks; slower suites must justify their own overrides.
 */
const TEST_TIMEOUT_MILLIS = 5_000;

export default defineProject({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    sequence: { shuffle: Boolean(process.env.CI) },
    testTimeout: TEST_TIMEOUT_MILLIS,
    hookTimeout: TEST_TIMEOUT_MILLIS,
  },
});
