import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { npmEnvironment } from './release-common.ts';
import { validateNpmArchive } from './release-npm-archive.ts';

/**
 * Installs the exact age-eligible npm CLI's bundled distribution without running a package manager
 * or lifecycle. The immutable integrity comes from the verified npm 12.2.1 registry metadata
 * (published 2026-10-15).
 */
const integrity: string =
  'sha512-bKCmFRVT/BB+YPEYbZwQ1XUI3N5t4xKSpU1MxOjo7z3iWzKBJ0ZXRC1xFdEN+TC7N5TdywaBzf2dMXGJq/e2PQ==';

/**
 * Keeps all credentialed-job tooling outside the source checkout.
 */
const directory: string = resolve(process.env.RUNNER_TEMP ?? '', 'npm-cli');
assert.ok(process.env.RUNNER_TEMP);
mkdirSync(directory, { recursive: false });

/**
 * Refuses redirect substitution and verifies the complete tarball before invoking the system
 * unpacker.
 */
const response: Response = await fetch('https://registry.npmjs.org/npm/-/npm-12.2.1.tgz', {
  redirect: 'error',
  signal: AbortSignal.timeout(30_000),
});
assert.ok(response.ok);

/**
 * Npm includes its runtime dependencies in this exact tarball, so no dependency resolution is
 * needed.
 */
const bytes: Buffer = Buffer.from(await response.arrayBuffer());
validateNpmArchive(bytes, integrity);
writeFileSync(resolve(directory, 'npm.tgz'), bytes, { flag: 'wx' });
execFileSync('tar', ['-xzf', resolve(directory, 'npm.tgz'), '-C', directory], { timeout: 30_000 });
symlinkSync('package/bin/npm-cli.js', resolve(directory, 'npm'));
writeFileSync(resolve(directory, 'empty.npmrc'), '', { flag: 'wx' });
assert.equal(
  execFileSync(process.execPath, [resolve(directory, 'package/bin/npm-cli.js'), '--version'], {
    cwd: directory,
    env: npmEnvironment(resolve(directory, 'empty.npmrc')),
    encoding: 'utf8',
    timeout: 30_000,
  }).trim(),
  '12.2.1',
);
