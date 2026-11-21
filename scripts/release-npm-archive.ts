import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';

import { digest } from './release-common.ts';

/**
 * Validates pinned npm distribution bytes and every tar path/type before the system unpacker sees
 * them.
 */
export function validateNpmArchive(bytes: Buffer, integrity: string): void {
  assert.equal(
    `sha512-${digest(bytes, 'sha512', 'base64')}`,
    integrity,
    'npm CLI integrity differs',
  );
  const tar = gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 });
  const names = new Set<string>();
  let cursor = 0;
  while (cursor + 512 <= tar.length) {
    const header = tar.subarray(cursor, cursor + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }

    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const path = prefix ? `${prefix}/${name}` : name;
    assert.ok(
      path.startsWith('package/') && !path.split('/').some((part) => part === '..' || part === '.'),
      'Unsafe npm tar path',
    );
    assert.ok(!path.includes('\\') && !names.has(path), 'Duplicate or unsafe npm tar name');
    names.add(path);
    assert.ok(
      header[156] === 0 || header[156] === 48 || header[156] === 53,
      'Nonregular npm tar entry',
    );
    const sizeText = header
      .subarray(124, 136)
      .toString('ascii')
      .replace(/[\0 ]+$/g, '');
    assert.match(sizeText, /^[0-7]+$/);
    const size = Number.parseInt(sizeText, 8);
    cursor += 512 + Math.ceil(size / 512) * 512;
    assert.ok(cursor <= tar.length, 'Truncated npm tar');
  }

  assert.ok(names.has('package/bin/npm-cli.js'), 'Missing npm CLI');
}
