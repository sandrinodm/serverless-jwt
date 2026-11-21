import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { channel, command, publicPackages, root } from './release-common.ts';

/**
 * Prepares one shared version only from a clean checkout, without creating a commit or tag.
 */
export function setVersion(version: string, directory: string = root): void {
  channel(version);
  assert.equal(
    command('git', ['status', '--porcelain', '--untracked-files=all'], directory),
    '',
    'Refusing dirty checkout',
  );
  const packages = publicPackages(directory);
  const updates = packages.map(({ path }) => {
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    return { path, content: `${JSON.stringify({ ...manifest, version }, null, 2)}\n` };
  });
  for (const { path, content } of updates) {
    writeFileSync(path, content);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  setVersion(process.argv[2] ?? '');
}
