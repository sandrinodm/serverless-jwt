import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import type { Artifact } from './release.ts';

import { outputDigest } from './cache.ts';
import { resolvedInternalImports, runtimeImports } from './release-imports.ts';

/**
 * Only these actual native producers emit measured, byte-identical traced runtime subsets.
 */
const outputs = {
  /**
   * Nuxt's native Nitro server tracer owns this output.
   */
  nuxt: '.output',

  /**
   * Standalone native Nitro uses the same supported output contract.
   */
  nitro: '.output',

  /**
   * The real Vercel CLI builds its documented local output tree.
   */
  vercel: '.vercel/output',
} as const;

/**
 * A successful native build binds its complete output and every derived internal file to archives.
 */
export interface NativeOutput {
  /**
   * Native fixture whose ordinary build produced the registered output root.
   */
  readonly producer: keyof typeof outputs;

  /**
   * Source/toolchain/archive identity computed before installation and the native build.
   */
  readonly key: string;

  /**
   * The previously verified npm-owned graph must survive the native build and snapshots unchanged.
   */
  readonly lock: string;

  /**
   * Complete native output, including traced third-party dependencies and entrypoints.
   */
  readonly output: string;

  /**
   * Every output path, byte and symlink target is revalidated before reuse or snapshot consumption.
   */
  readonly digest: string;

  /**
   * Each independent internal runtime subset retains exact manifest and supplied archive identity.
   */
  readonly packages: ReadonlyArray<{
    readonly path: string;
    readonly name: string;
    readonly artifact: string;
    readonly integrity: string;
    readonly files: ReadonlyArray<string>;
  }>;
}

/**
 * Formatting-independent lock identity remains stable when a snapshot rewrites the same origins.
 */
function lockDigest(app: string, artifacts: ReadonlyArray<Artifact>): string {
  const lock = JSON.parse(readFileSync(join(app, 'package-lock.json'), 'utf8')) as {
    readonly packages: Record<string, { resolved?: string }>;
  };
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (/(?:^|\/)node_modules\/@serverless-jwt\//u.test(path)) {
      assert.ok(
        typeof entry.resolved === 'string' && entry.resolved.startsWith('file:'),
        'Native graph contains a non-file origin',
      );
      const origin = realpathSync(resolve(app, entry.resolved.slice(5)));
      const artifact = artifacts.find((candidate) => candidate.path === origin);
      assert.ok(artifact, 'Native graph contains an unverified local origin');
      // Snapshot rebasing changes spelling, never the verified supplied archive identity.
      entry.resolved = 'file:' + artifact.path;
    }
  }

  return createHash('sha256').update(JSON.stringify(lock)).digest('hex');
}

/**
 * Traced packages have regular, app-owned files only; dependencies cannot hide below a subset.
 */
function copiedFiles(app: string, path: string): ReadonlyArray<string> {
  const root = resolve(app, path);
  assert.ok(root.startsWith(realpathSync(app) + sep), 'Native package escaped isolated app');
  assert.equal(realpathSync(root), root, 'Native package contains a symlink ancestor');
  const files: string[] = [];

  /**
   * A complete relative inventory rejects extra entries, nested copies, links and path escapes.
   */
  const walk = (directory: string): void => {
    assert.ok(lstatSync(directory).isDirectory(), 'Native package directory is not ordinary');
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      assert.ok(!entry.isSymbolicLink(), 'Native package contains a symlink');
      assert.notEqual(entry.name, 'node_modules', 'Native package contains nested dependencies');
      if (entry.isDirectory()) {
        walk(file);
      } else {
        assert.ok(entry.isFile(), 'Native package contains a non-file entry');
        files.push(relative(root, file).split(sep).join('/'));
      }
    }
  };
  walk(root);
  return files.sort();
}

/**
 * Shares the registered producer root between pre-build absence checks and output attestation.
 */
export function nativeOutputPath(producer: string): string | undefined {
  return Object.hasOwn(outputs, producer) ? outputs[producer as keyof typeof outputs] : undefined;
}

/**
 * Called only after successful native compilation over a raw-verified, unchanged installed graph.
 * The caller records this result rather than granting generic trust to generated directories.
 */
export function attestNativeOutput(
  app: string,
  producer: string,
  key: string,
  artifacts: ReadonlyArray<Artifact>,
  packages: ReadonlyArray<string>,
): NativeOutput | undefined {
  const output = nativeOutputPath(producer);
  if (!output) {
    return undefined;
  }

  const name = producer as keyof typeof outputs;
  const root = resolve(app, output);
  assert.equal(realpathSync(root), root, 'Native output escaped its registered root');
  const result: NativeOutput = {
    producer: name,
    key,
    lock: lockDigest(app, artifacts),
    output,
    digest: outputDigest(root),
    packages: packages
      .filter((path) => path.startsWith(root + sep) && resolve(path) === realpathSync(path))
      .map((path) => {
        const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
        const artifact = artifacts.find((entry) => entry.name === manifest.name);
        assert.ok(artifact, 'Native internal package has no supplied artifact');
        return {
          path: relative(app, path).split(sep).join('/'),
          name: artifact.name,
          artifact: artifact.path,
          integrity: artifact.integrity,
          files: copiedFiles(app, relative(app, path)),
        };
      }),
  };
  validateNativeOutput(app, artifacts, result);
  return result;
}

/**
 * Recomputes producer-bound provenance and exact supplied bytes on every native output use. This
 * does not register any additional location: the full app inventory rejects unlisted copies.
 */
export function validateNativeOutput(
  app: string,
  artifacts: ReadonlyArray<Artifact>,
  record: NativeOutput,
): ReadonlyArray<string> {
  assert.ok(Object.hasOwn(outputs, record.producer), 'Unregistered native output producer');
  assert.equal(record.output, outputs[record.producer], 'Unregistered native output path');
  assert.match(record.key, /^[a-f0-9]{64}$/u, 'Invalid native build identity');
  assert.equal(record.lock, lockDigest(app, artifacts), 'Native build graph identity changed');
  const root = resolve(app, record.output);
  assert.equal(realpathSync(root), root, 'Native output escaped its registered root');
  assert.equal(outputDigest(root), record.digest, 'Native build output changed');
  const verified: string[] = [];
  const modules: string[] = [];
  for (const entry of record.packages) {
    const installed = resolve(app, entry.path);
    assert.ok(installed.startsWith(root + sep), 'Native package outside registered output');
    assert.equal(
      entry.path,
      relative(app, installed).split(sep).join('/'),
      'Unsafe native package path',
    );
    assert.match(
      entry.path,
      /(?:^|\/)node_modules\/@serverless-jwt\/[^/]+$/u,
      'Invalid native package location',
    );
    assert.ok(!verified.includes(installed), 'Duplicate native package record');
    const artifact = artifacts.find((candidate) => candidate.name === entry.name);
    assert.ok(artifact, 'Native internal package has no supplied artifact');
    assert.equal(entry.artifact, artifact.path, 'Native archive origin changed');
    assert.equal(entry.integrity, artifact.integrity, 'Native archive integrity changed');
    assert.equal(
      createHash('sha256').update(readFileSync(artifact.path)).digest('hex'),
      artifact.sha256,
      'Native supplied archive changed',
    );
    assert.equal(
      entry.name,
      '@serverless-jwt/' + installed.split(sep).at(-1),
      'Native package name differs',
    );
    const files = copiedFiles(app, entry.path);
    assert.deepEqual(files, entry.files, 'Native package inventory changed');
    assert.ok(files.includes('package.json'), 'Native package has no manifest');
    const packed = new Set(
      execFileSync('tar', ['-tzf', artifact.path], { encoding: 'utf8' }).split('\n'),
    );
    for (const file of files) {
      const name = 'package/' + file;
      assert.ok(packed.has(name), 'Native package contains an unpacked file');
      assert.deepEqual(
        readFileSync(join(installed, file)),
        execFileSync('tar', ['-xOf', artifact.path, name]),
        'Native package file differs from supplied artifact',
      );
      if (/\.[cm]?js$/u.test(file)) {
        modules.push(join(installed, file));
      }
    }

    verified.push(installed);
  }

  // Native resolution also checks existence of relative targets, including deep runtime files.
  for (const request of resolvedInternalImports(runtimeImports(modules))) {
    if (request.specifier.startsWith('.')) {
      const owner = verified.find((installed) => request.importer.startsWith(installed + sep));
      assert.ok(
        owner && request.resolved.startsWith(owner + sep),
        'Native relative import escaped its package',
      );
    }
  }

  return verified;
}
