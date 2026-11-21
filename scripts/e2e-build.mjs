import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { outputDigest, restoreBuildOutput } from '../e2e/harness/src/cache.ts';
import { applicationCacheKey } from '../e2e/harness/src/release.ts';
import { capabilityMatrix } from '../e2e/matrix.ts';
import { buildApplicationNames } from './e2e-release-applications.mjs';

/**
 * Build cache lives outside source; all source/workspace hashes and actual runtime versions key it.
 */
const cache = resolve(
  process.env.E2E_BUILD_CACHE ?? join(tmpdir(), 'serverless-jwt-e2e-build-cache'),
);
/**
 * Only known generated outputs are restored; source/config files never come from cache.
 */
const outputs = [
  'dist',
  'build',
  '.next',
  '.svelte-kit',
  '.astro',
  '.output',
  '.vercel',
  '.netlify',
  '.nuxt',
  '.nitro',
  '.react-router',
  'react/.output',
  'solid/.output',
  'react/src/routeTree.gen.ts',
  'solid/src/routeTree.gen.ts',
  'next-env.d.ts',
];
/**
 * One shard builds its assigned project applications; nightly preparation explicitly includes
 * native hosts.
 */
const apps = resolve(import.meta.dirname, '../e2e/apps');
/**
 * Selects the registered PR or nightly build matrix without preparing unrelated native hosts.
 */
const project = process.env.E2E_DOCKER || process.env.E2E_PROJECT === 'nightly' ? 'nightly' : 'pr';
for (const name of buildApplicationNames(
  capabilityMatrix,
  readdirSync(apps),
  project,
  process.env.E2E_INTEGRATION,
)) {
  const app = join(apps, name);
  const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
  if (!manifest.scripts?.['build:app']) {
    continue;
  }

  mkdirSync(cache, { recursive: true, mode: 0o700 });
  const lock = join(cache, name + '.building');
  mkdirSync(lock);
  let staging;
  try {
    const key = applicationCacheKey(app, []);
    const entry = join(cache, name + '-' + key);
    const marker = join(entry, 'complete.json');
    if (existsSync(marker)) {
      const saved = JSON.parse(readFileSync(marker, 'utf8'));
      assert.equal(saved.key, key);
      for (const output of saved.outputs) {
        restoreBuildOutput(entry, app, output, saved.digests[output], outputs);
      }
    } else {
      execFileSync('pnpm', ['--dir', app, 'build:app'], { stdio: 'inherit', timeout: 180_000 });
      assert.equal(applicationCacheKey(app, []), key, 'Build inputs changed while compiling');
      staging = mkdtempSync(join(cache, name + '-partial-'));
      const digests = {};
      const available = outputs.filter((output) => existsSync(join(app, output)));
      for (const output of available) {
        cpSync(join(app, output), join(staging, output), {
          recursive: true,
          verbatimSymlinks: true,
        });
        digests[output] = outputDigest(join(staging, output));
      }

      writeFileSync(
        join(staging, 'complete.json'),
        JSON.stringify({ key, outputs: available, digests }) + '\n',
      );
      rmSync(entry, { recursive: true, force: true });
      renameSync(staging, entry);
    }
  } finally {
    if (staging) {
      rmSync(staging, { recursive: true, force: true });
    }

    rmSync(lock, { recursive: true, force: true });
  }
}
