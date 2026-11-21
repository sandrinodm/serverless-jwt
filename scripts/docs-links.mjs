import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Uses the explicitly installed pinned link checker when supplied by local or CI setup.
 */
const binary = process.env.LYCHEE_BIN ?? 'lychee';
assert.equal(
  execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim(),
  'lychee 0.24.2',
  'Use the integrity-checked pinned link checker',
);
/**
 * Inventories repository documentation and generated README links for the same link-check command.
 */
const inputs = execFileSync(
  'rg',
  [
    '--files',
    '--hidden',
    '-g',
    '*.md',
    '-g',
    '!node_modules',
    '-g',
    '!artifacts',
    '-g',
    '!reports',
    '-g',
    '!api',
  ],
  { encoding: 'utf8' },
)
  .trim()
  .split('\n');
assert.ok(inputs.includes('README.md') && inputs.includes('docs/configuration.md'));
/**
 * Keeps temporary link-check inputs outside the authored documentation tree.
 */
const temporary = mkdtempSync(join(tmpdir(), 'jwt-doc-links-'));
try {
  const list = join(temporary, 'inputs.txt');
  writeFileSync(list, inputs.join('\n') + '\n');
  const args = [
    '--include-fragments',
    '--files-from',
    list,
    '--root-dir',
    resolve('.'),
    '--no-progress',
  ];
  if (!process.argv.includes('--external')) {
    args.push('--offline');
  }

  // No status-code overrides, broad exclusions or stale cache can hide a failed link.
  execFileSync(binary, args, { stdio: 'inherit', timeout: 180_000 });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
