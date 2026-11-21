import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Permits genuine Markdown docs and version-only manifest changes, never executable examples.
 */
export function validateReleaseDiff(changes) {
  assert.ok(changes.length > 0, 'No candidate-to-stable changes supplied');
  for (const change of changes) {
    const { path, before, after, beforeMode, afterMode } = change;
    assert.ok(
      !path.includes('..') && !path.startsWith('/') && !path.includes('\\'),
      'Unsafe recorded path',
    );
    assert.ok(afterMode === '100644', `Nonregular or executable stable file: ${path}`);
    assert.ok(before === null || beforeMode === '100644', `Nonregular candidate file: ${path}`);
    if (
      /^(README|CHANGELOG|SECURITY)\.md$/.test(path) ||
      /^docs\/.+\.md$/.test(path) ||
      /^packages\/[^/]+\/README\.md$/.test(path)
    ) {
      assert.ok(after !== null, `Documentation deletion requires a new candidate: ${path}`);

      continue;
    }

    assert.match(
      path,
      /^(?:package\.json|packages\/[^/]+\/package\.json)$/,
      `Runtime, dependency or tooling change requires a new candidate: ${path}`,
    );
    assert.ok(before !== null && after !== null, `Manifest addition or deletion: ${path}`);
    const oldManifest = JSON.parse(before);
    const newManifest = JSON.parse(after);
    const oldVersion = oldManifest.version;
    const newVersion = newManifest.version;
    assert.equal(typeof oldVersion, 'string', `Missing candidate version: ${path}`);
    assert.equal(typeof newVersion, 'string', `Missing stable version: ${path}`);
    assert.match(oldVersion, /^\d+\.\d+\.\d+-rc\.\d+$/, `Expected approved rc.N: ${path}`);
    assert.equal(
      newVersion,
      oldVersion.replace(/-rc\.\d+$/, ''),
      `Stable version must promote the approved RC base: ${path}`,
    );
    delete oldManifest.version;
    delete newManifest.version;
    assert.deepEqual(
      newManifest,
      oldManifest,
      `Only the top-level version field may change: ${path}`,
    );
  }
}

/**
 * Reads immutable git trees without creating commits, tags, staging or working-tree changes.
 */
export function readGitDiff(candidate, stable) {
  /**
   * Passes refs and paths as arguments; never interprets them as shell commands.
   */
  const git = (args) =>
    execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const oldCommit = git([
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${candidate}^{commit}`,
  ]).trim();
  const newCommit = git(['rev-parse', '--verify', '--end-of-options', `${stable}^{commit}`]).trim();
  const records = git(['diff', '--raw', '--no-renames', '-z', oldCommit, newCommit, '--']).split(
    '\0',
  );
  const result = [];
  for (let index = 0; index < records.length - 1; index += 2) {
    const raw = records[index].match(/^:(\d+) (\d+) [a-f0-9]+ [a-f0-9]+ ([AMD])$/);
    assert.ok(raw, 'Unsupported git diff record');
    const path = records[index + 1];
    result.push({
      path,
      beforeMode: raw[1],
      afterMode: raw[2],
      before: raw[3] === 'A' ? null : git(['show', `${oldCommit}:${path}`]),
      after: raw[3] === 'D' ? null : git(['show', `${newCommit}:${path}`]),
    });
  }

  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(
    process.argv.length,
    4,
    'Usage: node scripts/release-diff.mjs APPROVED_RC_REF STABLE_REF',
  );
  const changes = readGitDiff(process.argv[2], process.argv[3]);
  validateReleaseDiff(changes);
  console.log(
    `Verified ${changes.length} candidate-to-stable paths: documentation and version fields only.`,
  );
}
