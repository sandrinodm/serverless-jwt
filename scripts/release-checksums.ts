import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { checkDirectory, digest, publicPackages } from './release-common.ts';

/**
 * Writes the independent per-file digest manifest only after the exact public inventory exists.
 */
const directory: string = process.env.PACKAGE_DIRECTORY ?? '';
assert.ok(directory);

/**
 * The actual public manifests define every artifact name before upload.
 */
const packages: ReturnType<typeof publicPackages> = publicPackages();
assert.deepEqual(readdirSync(directory).sort(), packages.map(({ filename }) => filename).sort());
writeFileSync(
  resolve(directory, 'SHA512SUMS'),
  packages
    .map(
      ({ filename }) =>
        `${digest(readFileSync(resolve(directory, filename)), 'sha512')}  ${filename}\n`,
    )
    .join(''),
  { flag: 'wx' },
);
checkDirectory(directory, packages);
