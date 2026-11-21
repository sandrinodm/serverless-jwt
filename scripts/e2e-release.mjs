import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  prepareReleaseApplication,
  releaseDirectory,
  tarballInventory,
} from '../e2e/harness/src/release.ts';
import { capabilityMatrix } from '../e2e/matrix.ts';
import { releaseApplicationNames } from './e2e-release-applications.mjs';

/**
 * Exact artifact input is mandatory; this command never builds replacement tarballs.
 */
const directory = resolve(process.argv[2] ?? process.env.E2E_FROM_TARBALLS ?? '');
assert.ok(process.argv[2] || process.env.E2E_FROM_TARBALLS, 'Supply the tested tarball directory');
/**
 * Complete application shards keep installs outside the workspace and memory/disk bounded.
 */
const artifacts = tarballInventory(directory);
/**
 * Inventories every public package so release tests require the complete supplied artifact set.
 */
const packages = readdirSync(new URL('../packages', import.meta.url))
  .map((name) =>
    JSON.parse(
      readFileSync(new URL('../packages/' + name + '/package.json', import.meta.url), 'utf8'),
    ),
  )
  .filter((manifest) => !manifest.private);
assert.deepEqual(
  artifacts.map((artifact) => artifact.name).sort((a, b) => a.localeCompare(b)),
  packages.map((manifest) => manifest.name).sort((a, b) => a.localeCompare(b)),
  'Release matrix requires every exact public artifact',
);
/**
 * Selects every registered PR application, with optional explicit integration sharding.
 */
const names = releaseApplicationNames(
  capabilityMatrix,
  readdirSync(new URL('../e2e/apps', import.meta.url)),
  process.env.E2E_INTEGRATION,
);
/**
 * Collects only freshly passed immutable-artifact rows, preserving per-app resolution evidence.
 */
const rows = [];
mkdirSync('reports/e2e-release', { recursive: true });
for (const name of names) {
  const applicationRows = capabilityMatrix.filter(
    (row) => (row.application ?? row.integration) === name,
  );
  const integration = applicationRows[0]?.integration;
  assert.ok(integration, 'Application has no capability matrix registration: ' + name);
  const parent = releaseDirectory();
  try {
    const app = prepareReleaseApplication(name, directory, parent);
    const mapping = join(parent, 'applications.json');
    writeFileSync(mapping, JSON.stringify({ [name]: app }), { mode: 0o600 });
    const result = spawnSync(
      process.execPath,
      [
        'node_modules/vite-plus/bin/vp',
        'test',
        'run',
        '--config',
        'e2e/vite.config.ts',
        '--project',
        'pr',
      ],
      {
        cwd: resolve(import.meta.dirname, '..'),
        env: {
          ...process.env,
          E2E_FROM_TARBALLS: directory,
          E2E_APPLICATIONS: mapping,
          E2E_INTEGRATION: integration,
          E2E_APPLICATION: name,
        },
        stdio: 'inherit',
      },
    );
    assert.equal(result.status, 0, 'Exact-tarball e2e project failed for ' + name);
    const completed = JSON.parse(readFileSync('reports/e2e-matrix/current.json', 'utf8'));
    rows.push(...completed.rows);
    writeFileSync(
      'reports/e2e-release/' + name + '-matrix.json',
      JSON.stringify(completed, null, 2) + '\n',
    );
    if (name === 'next') {
      // Registry/tarball consumers must run native Turbopack outside the checkout too.
      const development = spawnSync(
        process.execPath,
        [
          'node_modules/vite-plus/bin/vp',
          'test',
          'run',
          '--config',
          'e2e/vite.config.ts',
          '--project',
          'nightly',
        ],
        {
          cwd: resolve(import.meta.dirname, '..'),
          env: {
            ...process.env,
            E2E_FROM_TARBALLS: directory,
            E2E_APPLICATIONS: mapping,
            E2E_INTEGRATION: integration,
            E2E_APPLICATION: name,
            E2E_RUNTIME: 'next-development',
          },
          stdio: 'inherit',
        },
      );
      assert.equal(development.status, 0, 'Outside exact-tarball Next development matrix failed');
      writeFileSync(
        'reports/e2e-release/next-development.json',
        readFileSync('reports/e2e-matrix/current.json'),
      );
    }

    for (const metadata of [
      '.e2e-netlify-tools.json',
      '.e2e-native-types.json',
      '.e2e-native-build.json',
      '.e2e-native-compiler.json',
    ]) {
      if (existsSync(join(app, metadata))) {
        writeFileSync('reports/e2e-release/' + name + metadata, readFileSync(join(app, metadata)));
      }
    }

    writeFileSync(
      'reports/e2e-release/' + name + '-artifacts.json',
      readFileSync(join(app, '.e2e-artifacts.json')),
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

/**
 * No filtering mistake or future unmapped app may silently reduce the release capability set.
 */
const expected = capabilityMatrix
  .filter(
    (row) =>
      row.project === 'pr' &&
      (!process.env.E2E_INTEGRATION ||
        (row.application ?? row.integration) === process.env.E2E_INTEGRATION),
  )
  .map((row) => row.id)
  .sort((a, b) => a.localeCompare(b));
assert.deepEqual(
  rows
    .filter((row) => row.passed)
    .map((row) => row.id)
    .sort((a, b) => a.localeCompare(b)),
  expected,
);
writeFileSync('reports/e2e-release/matrix.json', JSON.stringify(rows, null, 2) + '\n');
