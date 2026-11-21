import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import type { Manifest } from './release-common.ts';

import { validateRepository } from './release-common.ts';

/**
 * Carries the checked tarball policy into later source-byte and consumer checks without
 * duplication.
 */
export interface ValidatedPackage {
  /**
   * Parsed artifact manifest used for source and internal dependency comparisons.
   */
  readonly manifest: Manifest;

  /**
   * Exact packed entries already checked for forbidden TypeScript sources.
   */
  readonly names: ReadonlyArray<string>;

  /**
   * Reviewed declaration companions whose presence and bytes must still match source.
   */
  readonly declarationCompanions: ReadonlyArray<string>;
}

/**
 * Reads the exact Astro repair declarations named and hashed by its audited shipped manifest.
 */
function astroCompanions(tarball: string, names: ReadonlyArray<string>): ReadonlyArray<string> {
  const profile = JSON.parse(
    execFileSync('tar', ['-xOf', tarball, 'package/dist/type-repair/manifest.json'], {
      encoding: 'utf8',
      timeout: 30_000,
    }),
  ) as {
    readonly astroVersion: string;
    readonly unstorage: { readonly version: string };
    readonly markdown: {
      readonly version: string;
      readonly repairs: ReadonlyArray<{ readonly source: string; readonly sha256: string }>;
    };
    readonly assets: ReadonlyArray<{ readonly path: string; readonly sha256: string }>;
    readonly repairs: ReadonlyArray<{ readonly source: string; readonly sha256: string }>;
    readonly generated: ReadonlyArray<{ readonly source: string; readonly sha256: string }>;
  };
  assert.equal(profile.astroVersion, '7.4.5', 'Unexpected Astro repair SDK profile');
  assert.equal(profile.unstorage.version, '1.17.6', 'Unexpected unstorage repair SDK profile');
  assert.equal(profile.markdown.version, '7.3.5', 'Unexpected markdown repair SDK profile');
  const inventory = [
    ...profile.assets,
    ...[...profile.repairs, ...profile.markdown.repairs, ...profile.generated].map((file) => ({
      path: file.source,
      sha256: file.sha256,
    })),
  ];
  const companions = new Set<string>();
  for (const file of inventory) {
    assert.match(
      file.path,
      /^(?:vendor|payloads)\/(?:[\w@-]+\/)*[\w.-]+\.d\.[cm]?ts$/u,
      'Invalid Astro declaration companion path',
    );
    assert.match(file.sha256, /^[a-f0-9]{64}$/u, 'Invalid Astro declaration companion digest');
    const path = `package/dist/type-repair/${file.path}`;
    assert.ok(names.includes(path), `Missing Astro declaration companion: ${path}`);
    const bytes = execFileSync('tar', ['-xOf', tarball, path], { timeout: 30_000 });
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      file.sha256,
      `Astro declaration companion digest differs: ${path}`,
    );
    companions.add(path);
  }

  return [...companions];
}

/**
 * Structural checks run before dependency installation so broken tarballs cannot reach consumer
 * execution.
 */
export function validatePackage(tarball: string): ValidatedPackage {
  const manifest = JSON.parse(
    execFileSync('tar', ['-xOf', tarball, 'package/package.json'], {
      encoding: 'utf8',
      timeout: 30_000,
    }),
  ) as Manifest;
  validateRepository(manifest);
  for (const section of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
    'devDependencies',
  ] as const) {
    for (const version of Object.values(manifest[section] ?? {})) {
      assert.doesNotMatch(version, /^(catalog:|workspace:)/, 'Unresolved dependency specifier');
    }
  }

  const names = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8', timeout: 30_000 })
    .trim()
    .split('\n');
  const declarationCompanions =
    manifest.name === '@serverless-jwt/next'
      ? ['package/dist/next-compat.d.ts', 'package/dist/sharp-compat.d.cts']
      : manifest.name === '@serverless-jwt/astro'
        ? astroCompanions(tarball, names)
        : [];
  for (const name of names) {
    assert.ok(
      !/\.[cm]?tsx?$/.test(name) || name.endsWith('.d.mts') || declarationCompanions.includes(name),
      `Source shipped: ${name}`,
    );
  }

  return { manifest, names, declarationCompanions };
}
