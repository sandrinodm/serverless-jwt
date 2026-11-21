import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'vite-plus/test';

import { validateReleaseDiff } from './release-diff.mjs';

/**
 * Supplies controlled recorded tree blobs without making real commits or tags.
 */
function change(path, before = 'before', after = 'after', modes = {}) {
  return { path, before, after, beforeMode: '100644', afterMode: '100644', ...modes };
}

const rc = {
  name: '@serverless-jwt/jwt-verifier',
  version: '1.0.0-rc.2',
  dependencies: { jose: '6.2.15' },
};
const stable = { ...rc, version: '1.0.0' };
const manifest = (value) => JSON.stringify(value);

test('recorded stable tree allows docs and exact top-level version promotion', () => {
  validateReleaseDiff([
    change('CHANGELOG.md'),
    change('docs/providers/auth0.md'),
    change('docs/examples/verify-locally/README.md'),
    change('packages/jwt-verifier/README.md'),
    change('packages/jwt-verifier/package.json', manifest(rc), manifest(stable)),
  ]);
});

for (const path of [
  'packages/jwt-verifier/src/verify.ts',
  'scripts/docs-reference.mjs',
  'pnpm-lock.yaml',
  '.github/workflows/publish.yml',
  'docs/examples/verify-locally/verify.mjs',
  'docs/examples/verify-locally/package.json',
  'docs/examples/verify-locally/pnpm-lock.yaml',
  'docs/examples/verify-locally/README.md.mjs',
  'docs/runtime.js',
]) {
  test(`recorded stable tree rejects runtime/dependency/tooling path ${path}`, () => {
    assert.throws(
      () => validateReleaseDiff([change(path)]),
      /Runtime, dependency or tooling change/,
    );
  });
}

for (const [name, value] of Object.entries({
  dependency: { ...stable, dependencies: { jose: '6.2.17' } },
  script: { ...stable, scripts: { postinstall: 'node malicious.mjs' } },
  export: { ...stable, exports: './other.mjs' },
  base: { ...stable, version: '1.0.1' },
})) {
  test(`recorded stable tree rejects manifest ${name} change`, () => {
    assert.throws(() =>
      validateReleaseDiff([
        change('packages/jwt-verifier/package.json', manifest(rc), manifest(value)),
      ]),
    );
  });
}

test('recorded stable tree rejects added/deleted manifests, symlinks, executable docs and deletion', () => {
  assert.throws(() =>
    validateReleaseDiff([change('packages/probe/package.json', null, manifest(stable))]),
  );
  assert.throws(() =>
    validateReleaseDiff([
      change('packages/probe/package.json', manifest(rc), null, { afterMode: '000000' }),
    ]),
  );
  assert.throws(() =>
    validateReleaseDiff([change('docs/guide.md', 'old', 'new', { afterMode: '120000' })]),
  );
  assert.throws(() =>
    validateReleaseDiff([change('docs/guide.md', 'old', 'new', { afterMode: '100755' })]),
  );
  assert.throws(() =>
    validateReleaseDiff([change('docs/guide.md', 'old', null, { afterMode: '000000' })]),
  );
  assert.throws(() => validateReleaseDiff([]));
});

/**
 * Runs the real CLI against an argument-recording git executable and immutable tree blobs.
 */
function recordedGitRun(changes, candidate = 'approved-rc', stableRef = 'stable') {
  const directory = mkdtempSync(join(tmpdir(), 'jwt-recorded-git-'));
  try {
    const records = join(directory, 'records.json');
    const calls = join(directory, 'calls.jsonl');
    writeFileSync(records, JSON.stringify(changes));
    const git = join(directory, 'git');
    writeFileSync(
      git,
      `#!${process.execPath}
import { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.GIT_CALLS, JSON.stringify(args) + '\\n');
const changes = JSON.parse(readFileSync(process.env.GIT_RECORDS, 'utf8'));
const oldCommit = 'a'.repeat(40);
const newCommit = 'b'.repeat(40);
if (args[0] === 'rev-parse') {
  if (JSON.stringify(args.slice(1, 4)) !== JSON.stringify(['--verify', '--end-of-options', process.env.EXPECTED_CANDIDATE + '^{commit}']) && JSON.stringify(args.slice(1, 4)) !== JSON.stringify(['--verify', '--end-of-options', process.env.EXPECTED_STABLE + '^{commit}'])) process.exit(91);
  process.stdout.write(args[3] === process.env.EXPECTED_CANDIDATE + '^{commit}' ? oldCommit : newCommit);
} else if (args[0] === 'diff') {
  if (JSON.stringify(args) !== JSON.stringify(['diff', '--raw', '--no-renames', '-z', oldCommit, newCommit, '--'])) process.exit(92);
  process.stdout.write(changes.map((entry) => ':' + entry.beforeMode + ' ' + entry.afterMode + ' aaaaaaa bbbbbbb M\\0' + entry.path + '\\0').join(''));
} else if (args[0] === 'show') {
  const ref = args[1].slice(0, 40);
  const path = args[1].slice(41);
  const entry = changes.find((value) => value.path === path);
  if (!entry || ![oldCommit, newCommit].includes(ref) || args.length !== 2) process.exit(93);
  process.stdout.write(ref === oldCommit ? entry.before : entry.after);
} else {
  process.exit(94);
}
`,
    );
    chmodSync(git, 0o755);
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/release-diff.mjs'), candidate, stableRef],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: directory + ':' + process.env.PATH,
          GIT_RECORDS: records,
          GIT_CALLS: calls,
          EXPECTED_CANDIDATE: candidate,
          EXPECTED_STABLE: stableRef,
        },
      },
    );
    assert.equal(result.error, undefined);
    const commands = readFileSync(calls, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.ok(commands.every((args) => ['rev-parse', 'diff', 'show'].includes(args[0])));
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      commands,
      markerExists: existsSync(join(directory, 'unwanted')),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('real release-diff CLI reads only resolved recorded trees and allows approved version/docs', () => {
  const result = recordedGitRun([
    change('README.md'),
    change('packages/jwt-verifier/package.json', manifest(rc), manifest(stable)),
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified 2 candidate-to-stable paths/);
  assert.equal(result.commands.length, 7);
  assert.deepEqual(result.commands[0], [
    'rev-parse',
    '--verify',
    '--end-of-options',
    'approved-rc^{commit}',
  ]);
});

for (const value of [
  change('docs/examples/verify-locally/package.json', manifest(rc), manifest(stable)),
  change('docs/examples/verify-locally/verify.mjs'),
  change('README.md', 'old', 'new', { afterMode: '120000' }),
]) {
  test(`real release-diff CLI rejects recorded runtime or symlink boundary ${value.path}`, () => {
    const result = recordedGitRun([value]);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /Verified/);
  });
}

test('real release-diff CLI preserves hostile-looking refs as single git arguments', () => {
  const result = recordedGitRun(
    [change('README.md')],
    'rc; touch unwanted; $(touch unwanted)',
    '--output=unwanted',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.markerExists, false);
  assert.equal(result.commands[0][3], 'rc; touch unwanted; $(touch unwanted)^{commit}');
  assert.equal(result.commands[1][3], '--output=unwanted^{commit}');
});
