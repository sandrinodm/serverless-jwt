import assert from 'node:assert/strict';
import { mkdtempDisposableSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vite-plus/test';

it('uses fixed glob through actual Testcontainers archive consumers and builds real ZIP bytes', async () => {
  const harness = createRequire(new URL('../package.json', import.meta.url));
  const consumer = createRequire(harness.resolve('testcontainers'));
  const archiveEntry = consumer.resolve('archiver');
  const archiveRequire = createRequire(archiveEntry);
  const utilityEntry = archiveRequire.resolve('archiver-utils');
  const utility = createRequire(utilityEntry);
  const glob = utility.resolve('glob');
  expect(JSON.parse(readFileSync(join(dirname(glob), '../../package.json'), 'utf8')).version).toBe(
    '14.0.3',
  );
  using temporary = mkdtempDisposableSync(join(tmpdir(), 'jwt-archive-regression-'));
  mkdirSync(join(temporary.path, 'nested'));
  writeFileSync(join(temporary.path, 'nested/proof.txt'), 'synthetic-archive-proof');
  expect(utility('./file').expand({ cwd: temporary.path }, ['**/*.txt'])).toEqual([
    'nested/proof.txt',
  ]);
  const archive = (await import(archiveEntry)).default('zip');
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  await archive.directory(temporary.path, false).finalize();
  const bytes = Buffer.concat(chunks);
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  expect(bytes.includes(Buffer.from('nested/proof.txt'))).toBe(true);
});
