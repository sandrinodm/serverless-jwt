import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, readFileSync, readdirSync, readlinkSync, lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Attests every generated output byte and symlink target before cache restore and after copying.
 */
export function outputDigest(directory: string): string {
  const hash = createHash('sha256');
  /**
   * Ordered relative paths prevent rename or file-boundary ambiguity from retaining the digest.
   */
  const visit = (path: string, relative: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const name = relative + '/' + entry.name;
      hash.update(
        JSON.stringify([
          name,
          entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'link' : 'file',
        ]),
      );
      if (entry.isDirectory()) {
        visit(join(path, entry.name), name);
      } else if (entry.isSymbolicLink()) {
        hash.update(JSON.stringify(readlinkSync(join(path, entry.name))));
      } else {
        const bytes = readFileSync(join(path, entry.name));
        hash.update(String(bytes.length) + ':').update(bytes);
      }
    }
  };
  const root = lstatSync(directory);
  if (root.isDirectory()) {
    visit(directory, '');
  } else if (root.isSymbolicLink()) {
    hash.update('link:').update(readlinkSync(directory));
  } else {
    hash.update('file:').update(readFileSync(directory));
  }

  return hash.digest('hex');
}

/**
 * Restores only an allowed attested output, rejecting tampered cache bytes before destination
 * writes.
 */
export function restoreBuildOutput(
  cache: string,
  app: string,
  output: string,
  digest: string,
  allowed: ReadonlyArray<string>,
): void {
  assert.ok(allowed.includes(output), 'Cache attempted to restore a non-output path');
  assert.equal(outputDigest(join(cache, output)), digest, 'Cached output bytes changed');
  rmSync(join(app, output), { recursive: true, force: true });
  cpSync(join(cache, output), join(app, output), { recursive: true, verbatimSymlinks: true });
  assert.equal(outputDigest(join(app, output)), digest, 'Restored output bytes changed');
}
