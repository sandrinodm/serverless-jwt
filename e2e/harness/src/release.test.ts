import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdtempDisposableSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vite-plus/test';

import {
  assertReleaseResolution,
  releaseManifest,
  snapshotApplication,
  tarballInventory,
} from './release.ts';

// The test packs and installs real files; corrupting locks or installed bytes must fail independently.
it('installs exact transitive local tarballs and rejects registry origin, symlinks and byte tampering', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-release-proof-'));
  const tarballs = join(directory.path, 'tarballs');
  mkdirSync(tarballs);
  for (const name of ['core', 'adapter']) {
    const root = join(directory.path, name);
    mkdirSync(join(root, 'package'), { recursive: true });
    writeFileSync(
      join(root, 'package/package.json'),
      JSON.stringify({
        name: '@serverless-jwt/' + name,
        version: '0.0.0',
        type: 'module',
        exports: './index.mjs',
        ...(name === 'adapter' ? { dependencies: { '@serverless-jwt/core': '0.0.0' } } : {}),
      }),
    );
    writeFileSync(
      join(root, 'package/index.mjs'),
      name === 'adapter'
        ? 'export { verified } from "@serverless-jwt/core";\n'
        : 'export const verified = true;\n',
    );
    execFileSync('tar', ['-czf', join(tarballs, name + '.tgz'), '-C', root, 'package']);
  }

  const artifacts = tarballInventory(tarballs);
  const app = join(directory.path, 'consumer');
  mkdirSync(app);
  const manifest = releaseManifest(
    { name: 'consumer', private: true, dependencies: { '@serverless-jwt/adapter': 'workspace:*' } },
    {},
    artifacts,
  );
  writeFileSync(join(app, 'package.json'), JSON.stringify(manifest));
  execFileSync(
    process.execPath,
    [
      new URL('../../../node_modules/npm/bin/npm-cli.js', import.meta.url).pathname,
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--offline',
    ],
    { cwd: app, stdio: 'pipe', timeout: 30_000 },
  );
  expect(() => assertReleaseResolution(app, artifacts)).not.toThrow();
  vi.stubEnv('E2E_FROM_TARBALLS', tarballs);
  const snapshot = snapshotApplication(app, join(directory.path, 'snapshot'));
  expect(() => assertReleaseResolution(snapshot, artifacts)).not.toThrow();
  expect(snapshot.startsWith(directory.path)).toBe(true);
  const shadow = join(
    app,
    'node_modules/@serverless-jwt/adapter/node_modules/@serverless-jwt/core',
  );
  cpSync(join(app, 'node_modules/@serverless-jwt/core'), shadow, { recursive: true });
  writeFileSync(join(shadow, 'index.mjs'), 'export const verified = false;\n');
  // Native ESM executes the nested bytes through the adapter, independently of this assertion.
  const executed = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'import { verified } from "@serverless-jwt/adapter"; process.stdout.write(String(verified));',
    ],
    { cwd: app, encoding: 'utf8', timeout: 5_000 },
  );
  expect(executed).toBe('false');
  expect(() => assertReleaseResolution(app, artifacts)).toThrow(
    'Unrecorded physical internal package',
  );
  rmSync(shadow, { recursive: true });
  symlinkSync(join(directory.path, 'core/package'), shadow, 'dir');
  expect(() => assertReleaseResolution(app, artifacts)).toThrow('escaped isolated app');
  rmSync(shadow);
  const installedCore = join(app, 'node_modules/@serverless-jwt/core');
  rmSync(installedCore, { recursive: true });
  symlinkSync(join(directory.path, 'core/package'), installedCore, 'dir');
  expect(() => assertReleaseResolution(app, artifacts)).toThrow('escaped isolated app');
  rmSync(installedCore);
  cpSync(join(directory.path, 'core/package'), installedCore, { recursive: true });
  const lockPath = join(app, 'package-lock.json');
  const original = readFileSync(lockPath, 'utf8');
  const lock = JSON.parse(original);
  lock.packages['node_modules/@serverless-jwt/core'].resolved =
    'https://registry.npmjs.org/@serverless-jwt/core/-/core-0.0.0.tgz';
  writeFileSync(lockPath, JSON.stringify(lock));
  expect(() => assertReleaseResolution(app, artifacts)).toThrow('outside supplied tarballs');
  writeFileSync(lockPath, original);
  writeFileSync(
    join(app, 'node_modules/@serverless-jwt/core/index.mjs'),
    'export const verified = false;\n',
  );
  expect(() => assertReleaseResolution(app, artifacts)).toThrow('differs from supplied artifact');
  expect(() => assertReleaseResolution(snapshot, artifacts)).not.toThrow();
});

it('fails closed on missing artifacts and unresolved nonpublic workspace dependencies', () => {
  expect(() =>
    releaseManifest({ dependencies: { '@serverless-jwt/missing': 'workspace:*' } }, {}, []),
  ).toThrow('Missing supplied tarball');
  expect(() =>
    releaseManifest({ dependencies: { 'private-fixture': 'workspace:*' } }, {}, []),
  ).toThrow('Nonpublic workspace');
  expect(
    releaseManifest({ dependencies: { jose: 'catalog:' } }, { jose: '6.2.15' }, []),
  ).toMatchObject({ dependencies: { jose: '6.2.15' } });
});

/**
 * Installed Astro consumers retain the real public repair while avoiding workspace source builds.
 */
it('adapts only the exact Astro preparation scripts to the independently owned installed app', () => {
  const source = JSON.parse(
    readFileSync(new URL('../../apps/astro/package.json', import.meta.url), 'utf8'),
  ) as {
    readonly name: string;
    readonly scripts: Readonly<Record<string, string>>;
  };
  const input = { name: source.name, scripts: source.scripts };
  const before = structuredClone(input);
  const prepared = releaseManifest(input, {}, []);
  expect(prepared.scripts).toEqual({
    ...source.scripts,
    'prepare:peers':
      "node --input-type=module -e \"await import('@serverless-jwt/astro'); await import('@serverless-jwt/astro/build'); await import('@serverless-jwt/astro/type-repair')\"",
    'repair:types': source.scripts['repair:types']?.replace(
      "installationRoot: '../../..'",
      "installationRoot: '.'",
    ),
  });
  expect(input).toEqual(before);
});

/**
 * New workspace preparation shapes require reassessment instead of a silent installed-app rewrite.
 */
it.each(['prepare:peers', 'repair:types'])(
  'rejects a changed Astro %s preparation contract',
  (name) => {
    const source = JSON.parse(
      readFileSync(new URL('../../apps/astro/package.json', import.meta.url), 'utf8'),
    ) as {
      readonly name: string;
      readonly scripts: Readonly<Record<string, string>>;
    };
    const input = {
      name: source.name,
      scripts: { ...source.scripts, [name]: source.scripts[name] + ' --unexpected' },
    };
    expect(() => releaseManifest(input, {}, [])).toThrow('Reassess Astro installed');
  },
);
