import { defineConfig, mergeConfig } from 'vite-plus';
import { configDefaults } from 'vite-plus/test/config';

import shared from '../test.config.ts';
import { flociIsolationFile } from './matrix.ts';

/**
 * Shards run complete integration rows; the reporter rejects partial row filtering.
 */
const integration = process.env.E2E_INTEGRATION;

/**
 * Hosted nightly jobs split the full suite at the Floci200 runner capacity boundary.
 */
const nightlyScope = process.env.E2E_NIGHTLY_SCOPE;
if (nightlyScope !== undefined && nightlyScope !== 'standard' && nightlyScope !== 'floci200') {
  throw new Error('Invalid E2E_NIGHTLY_SCOPE');
}

/**
 * Runtime release tests use only copied installed apps; in-process workspace conformance stays
 * PR-only.
 */
const prIncludes = process.env.E2E_FROM_TARBALLS
  ? ['e2e/harness/src/security.test.ts', 'e2e/harness/src/matrix.test.ts']
  : integration
    ? [
        'e2e/harness/src/security.test.ts',
        'e2e/harness/src/matrix.test.ts',
        'e2e/harness/src/logs.test.ts',
        'e2e/harness/src/log-stream.test.ts',
        'e2e/harness/src/archive.test.ts',
        'e2e/harness/src/release.test.ts',
        'e2e/harness/src/release-shadow.test.ts',
        'e2e/harness/src/netlify-patch.test.ts',
        'e2e/harness/src/cache.test.ts',
        ...(integration === 'react-router' ? ['e2e/harness/src/router-logs.test.ts'] : []),
        'e2e/harness/src/shards.test.ts',
        'e2e/harness/src/docker-logs.test.ts',
        'e2e/harness/src/docker-lifecycle.test.ts',
        'e2e/harness/src/router-patch.test.ts',
        'e2e/harness/src/floci-keyring.test.ts',
        'e2e/harness/src/vercel-development.test.ts',
        'e2e/harness/src/' +
          (integration === 'reference-express' ? 'contract' : integration) +
          '.test.ts',
      ]
    : [
        'e2e/harness/src/**/*.test.ts',
        ...(process.env.E2E_FROM_TARBALLS
          ? []
          : ['e2e/apps/reference-express/src/conformance.test.ts']),
        'e2e/apps/sveltekit/src/build.spec.ts',
      ];
export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    reporters: [
      'default',
      './scripts/e2e-reporter.mjs',
      ['./scripts/conformance-reporter.mjs', { directory: 'reports/conformance-e2e' }],
    ],
    projects: [
      mergeConfig(shared, {
        test: {
          name: 'pr',
          env: { CONFORMANCE_REPORT_DIRECTORY: 'reports/conformance-e2e', E2E_PROJECT: 'pr' },
          globalSetup: ['e2e/harness/src/global-setup.ts'],
          include: prIncludes,
        },
      }),
      mergeConfig(shared, {
        test: {
          name: 'nightly',
          env: { E2E_PROJECT: 'nightly' },
          // Native builders/dev tools and Docker capacity probes own whole files in sequence.
          fileParallelism: false,
          globalSetup: ['e2e/harness/src/global-setup.ts'],
          include:
            nightlyScope === 'floci200'
              ? [flociIsolationFile]
              : [
                  ...prIncludes,
                  ...(integration
                    ? ['e2e/apps/' + integration + '/src/**/*.spec.ts']
                    : ['e2e/**/*.spec.ts', 'e2e/platforms/*.docker.e2e.ts']),
                ],
          ...(nightlyScope === 'standard'
            ? { exclude: [...configDefaults.exclude, flociIsolationFile] }
            : {}),
        },
      }),
    ],
  },
});
