import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempDisposableSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  channel,
  checkDirectory,
  digest,
  npmEnvironment,
  publicPackages,
  root,
} from './release-common.ts';

/**
 * Publishes only authorized, tested bytes; retries skip an existing version only when its SHA512 is
 * identical.
 */
export function publishAll(directory: string, dryRun: boolean, sourceRoot: string = root): void {
  const packages = publicPackages(sourceRoot);
  checkDirectory(directory, packages);
  using temporary = mkdtempDisposableSync(join(tmpdir(), 'jwt-publish-'));
  const config = join(temporary.path, 'empty.npmrc');
  writeFileSync(config, '', { flag: 'wx' });
  const env = npmEnvironment(config);
  for (const { manifest, filename } of packages) {
    const tarball = resolve(directory, filename);
    const integrity = `sha512-${digest(readFileSync(tarball), 'sha512', 'base64')}`;
    if (dryRun) {
      console.log(`dry-run ${manifest.name}@${manifest.version} ${integrity}`);
      continue;
    }

    const view = spawnSync(
      'npm',
      [
        'view',
        `${manifest.name}@${manifest.version}`,
        'dist.integrity',
        '--json',
        '--registry=https://registry.npmjs.org/',
      ],
      { cwd: temporary.path, env, encoding: 'utf8', timeout: 180_000 },
    );
    assert.ifError(view.error);
    if (view.status === 0) {
      const response: unknown = JSON.parse(view.stdout);
      if (Array.isArray(response)) {
        assert.equal(response.length, 1, 'Ambiguous registry integrity');
      }

      const existing: unknown = Array.isArray(response) ? response[0] : response;
      assert.equal(existing, integrity, 'Existing version integrity differs; refusing publication');
      console.log(`skip ${manifest.name}@${manifest.version}`);
      continue;
    }

    const error = JSON.parse(view.stdout || '{}') as {
      readonly error?: { readonly code?: string };
    };
    assert.equal(error.error?.code, 'E404', `Registry lookup failed: ${view.stderr}`);
    const result = spawnSync(
      'npm',
      [
        'publish',
        tarball,
        '--access',
        'public',
        '--provenance',
        '--ignore-scripts',
        '--tag',
        channel(manifest.version),
        '--registry=https://registry.npmjs.org/',
      ],
      { cwd: temporary.path, env, stdio: 'inherit', timeout: 180_000 },
    );
    assert.ifError(result.error);
    assert.equal(
      result.status,
      0,
      'Publication failed; verify trusted-publisher setup in docs/releasing.md and resume the same artifacts',
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flag = process.argv[3];
  assert.ok(
    flag === '--dry-run' || flag === '--publish',
    'Explicit --dry-run or --publish required',
  );
  publishAll(process.argv[2] ?? '', flag === '--dry-run');
}
