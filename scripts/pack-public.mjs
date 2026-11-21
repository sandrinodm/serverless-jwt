import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Selects public package manifests explicitly: pnpm recursive pack includes private packages too.
 */
const root = resolve(import.meta.dirname, '..');
/**
 * Expands only current public package names so future private fixtures cannot enter artifacts.
 */
const packages = readdirSync(resolve(root, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) =>
    JSON.parse(readFileSync(resolve(root, 'packages', entry.name, 'package.json'), 'utf8')),
  )
  .filter((manifest) => manifest.private !== true)
  .map((manifest) => manifest.name)
  .sort((a, b) => a.localeCompare(b));
assert.ok(packages.length > 0, 'No public packages to pack');
execFileSync(
  'pnpm',
  [
    ...packages.flatMap((name) => ['--filter', name]),
    '-r',
    'pack',
    '--pack-destination',
    resolve(process.argv[2] ?? resolve(root, 'artifacts')),
  ],
  { cwd: root, stdio: 'inherit' },
);
