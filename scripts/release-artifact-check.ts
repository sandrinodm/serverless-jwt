import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';

import { checkDirectory, digest, publicPackages, root } from './release-common.ts';

/**
 * Reads a bounded GitHub artifact ZIP only after its API-authorized SHA256 matches. Central and
 * local headers must agree; only flat regular files with stored/deflated data are accepted.
 */
export function readArchive(
  bytes: Buffer,
  authorizedDigest: string,
  expected: ReadonlyArray<string>,
): ReadonlyMap<string, Buffer> {
  assert.match(authorizedDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    `sha256:${digest(bytes, 'sha256')}`,
    authorizedDigest,
    'Archive digest differs from authorization',
  );
  assert.ok(bytes.length <= 256 * 1024 * 1024, 'Archive exceeds size bound');
  const end = bytes.length - 22;
  assert.ok(
    end >= 0 && bytes.readUInt32LE(end) === 0x06054b50,
    'ZIP must have one uncommented end record',
  );
  assert.equal(bytes.readUInt16LE(end + 4), 0);
  assert.equal(bytes.readUInt16LE(end + 6), 0);
  const count = bytes.readUInt16LE(end + 10);
  assert.equal(bytes.readUInt16LE(end + 8), count);
  assert.equal(count, expected.length, 'Archive inventory count differs');
  let cursor = bytes.readUInt32LE(end + 16);
  const start = cursor;
  assert.equal(start + bytes.readUInt32LE(end + 12), end, 'Invalid central directory');
  const files = new Map<string, Buffer>();
  const intervals: Array<readonly [number, number]> = [];
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50);
    const flags = bytes.readUInt16LE(cursor + 8);
    assert.equal(flags & ~0x808, 0, 'Unsupported ZIP flags');
    const method = bytes.readUInt16LE(cursor + 10);
    assert.ok(method === 0 || method === 8, 'Unsupported ZIP compression');
    const size = bytes.readUInt32LE(cursor + 20);
    const expanded = bytes.readUInt32LE(cursor + 24);
    total += expanded;
    assert.ok(total <= 256 * 1024 * 1024, 'Expanded archive exceeds bound');
    const length = bytes.readUInt16LE(cursor + 28);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + length);
    const name = nameBytes.toString('utf8');
    assert.match(name, /^(?:[a-z0-9.-]+\.tgz|SHA512SUMS)$/);
    assert.ok(expected.includes(name) && !files.has(name), 'Unexpected or duplicate archive entry');
    const mode = bytes.readUInt32LE(cursor + 38) >>> 16;
    assert.ok((mode & 0xf000) === 0 || (mode & 0xf000) === 0x8000, 'Nonregular ZIP entry');
    assert.equal(bytes.readUInt16LE(cursor + 34), 0, 'Multidisk archive');
    const offset = bytes.readUInt32LE(cursor + 42);
    assert.equal(bytes.readUInt32LE(offset), 0x04034b50);
    assert.equal(bytes.readUInt16LE(offset + 6), flags);
    assert.equal(bytes.readUInt16LE(offset + 8), method);
    assert.equal(bytes.readUInt16LE(offset + 26), length);
    assert.deepEqual(bytes.subarray(offset + 30, offset + 30 + length), nameBytes);
    const data = offset + 30 + length + bytes.readUInt16LE(offset + 28);
    assert.ok(data + size <= start, 'ZIP data overlaps central directory');
    intervals.push([offset, data + size]);
    const compressed = bytes.subarray(data, data + size);
    const output =
      method === 0
        ? compressed
        : inflateRawSync(compressed, { maxOutputLength: Math.max(1, expanded) });
    assert.equal(output.length, expanded, 'ZIP expanded length differs');
    files.set(name, output);
    cursor += 46 + length + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
  }

  assert.equal(cursor, end);
  intervals.sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < intervals.length; index += 1) {
    const current = intervals[index];
    const previous = intervals[index - 1];
    assert.ok(current && previous);
    assert.ok(current[0] >= previous[1], 'Overlapping ZIP entries');
  }

  assert.deepEqual([...files.keys()].sort(), [...expected].sort());
  return files;
}

/**
 * Extracts only previously authorized flat names, then validates the independent SHA512 manifest.
 */
export function checkArchive(
  archive: string,
  authorizedDigest: string,
  directory: string,
  sourceRoot: string = root,
): void {
  const packages = publicPackages(sourceRoot);
  const files = readArchive(readFileSync(archive), authorizedDigest, [
    ...packages.map(({ filename }) => filename),
    'SHA512SUMS',
  ]);
  mkdirSync(directory, { recursive: false });
  for (const [name, bytes] of files) {
    writeFileSync(resolve(directory, name), bytes, { flag: 'wx', mode: 0o600 });
  }

  checkDirectory(directory, packages);
}

/**
 * The action derives its archive filename from HTTP headers; accept exactly one regular download,
 * never guess its name.
 */
export function checkDownload(download: string, authorizedDigest: string, directory: string): void {
  const entries = readdirSync(download);
  assert.equal(entries.length, 1, 'Exactly one downloaded archive required');
  const filename = entries[0];
  assert.ok(filename);
  const archive = resolve(download, filename);
  assert.ok(lstatSync(archive).isFile(), 'Downloaded archive must be a regular file');
  checkArchive(archive, authorizedDigest, directory);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkDownload(process.argv[2] ?? '', process.env.ARTIFACT_DIGEST ?? '', process.argv[3] ?? '');
}
