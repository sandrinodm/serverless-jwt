import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vite-plus/test';

import { validatePackage } from './package-validation.ts';

/**
 * Exercises the actual package-smoke entrypoint with deliberately malformed packed bytes, before
 * installs.
 */
it.each(
  [
    'typescript source',
    'workspace dependency',
    'missing repository directory',
    'stale repository owner',
  ].flatMap((broken) => [
    { broken, runtime: 'unset' },
    { broken, runtime: 'missing' },
  ]),
)('rejects a tarball with $broken when minimum Node is $runtime', ({ broken, runtime }) => {
  using temp = mkdtempDisposableSync(join(tmpdir(), 'package-negative-'));
  mkdirSync(join(temp.path, 'package/dist'), { recursive: true });
  mkdirSync(join(temp.path, 'artifacts'));
  const manifest = {
    name: '@serverless-jwt/jwt-verifier',
    version: '0.0.0',
    repository: {
      url: 'git+https://github.com/sandrinodm/serverless-jwt.git',
      directory: 'packages/jwt-verifier',
    },
    dependencies: {},
  };
  if (broken === 'typescript source') {
    writeFileSync(join(temp.path, 'package/dist/source.ts'), 'export const source = true;');
  }

  if (broken === 'workspace dependency') {
    manifest.dependencies.core = 'workspace:*';
  }

  if (broken === 'missing repository directory') {
    delete manifest.repository.directory;
  }

  if (broken === 'stale repository owner') {
    manifest.repository.url = 'git+https://github.com/sandrinodimattia/serverless-jwt.git';
  }

  writeFileSync(join(temp.path, 'package/package.json'), JSON.stringify(manifest));
  execFileSync('tar', [
    '-czf',
    join(temp.path, 'artifacts/broken.tgz'),
    '-C',
    temp.path,
    'package',
  ]);
  const env = { ...process.env };
  delete env.MIN_NODE_BIN;
  if (runtime === 'missing') {
    env.MIN_NODE_BIN = join(temp.path, 'missing-node24');
  }

  const result = spawnSync(
    process.execPath,
    [resolve(import.meta.dirname, 'package-smoke.mjs'), join(temp.path, 'artifacts')],
    {
      encoding: 'utf8',
      timeout: 30_000,
      env,
    },
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    broken === 'typescript source'
      ? 'Source shipped'
      : broken === 'workspace dependency'
        ? 'Unresolved dependency'
        : broken === 'missing repository directory'
          ? 'Missing repository.directory'
          : 'Repository URL differs from canonical upstream',
  );
});

/**
 * Valid canonical artifacts reach the mandatory runtime boundary without private prerequisites.
 */
it.each([undefined, process.execPath])(
  'requires exact minimum Node after structural validation with %s',
  (minimumNode) => {
    using temp = mkdtempDisposableSync(join(tmpdir(), 'package-runtime-boundary-'));
    mkdirSync(join(temp.path, 'package/dist'), { recursive: true });
    mkdirSync(join(temp.path, 'artifacts'));
    writeFileSync(
      join(temp.path, 'package/package.json'),
      JSON.stringify({
        name: '@serverless-jwt/jwt-verifier',
        version: '0.0.0',
        repository: {
          url: 'git+https://github.com/sandrinodm/serverless-jwt.git',
          directory: 'packages/jwt-verifier',
        },
      }),
    );
    const tarball = join(temp.path, 'artifacts/canonical.tgz');
    execFileSync('tar', ['-czf', tarball, '-C', temp.path, 'package']);
    expect(() => validatePackage(tarball)).not.toThrow();
    const env = { ...process.env };
    delete env.MIN_NODE_BIN;
    if (minimumNode) {
      env.MIN_NODE_BIN = minimumNode;
    }

    const result = spawnSync(
      process.execPath,
      [resolve(import.meta.dirname, 'package-smoke.mjs'), join(temp.path, 'artifacts')],
      { encoding: 'utf8', timeout: 30_000, env },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(minimumNode ? 'v24.0.0' : 'Set MIN_NODE_BIN');
  },
);

/**
 * The returned reviewed companion inventory is the policy reused by source-byte smoke checks.
 */
it('preserves reviewed Next declaration companions and rejects an unreviewed declaration', () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), 'package-companions-'));
  mkdirSync(join(temp.path, 'package/dist'), { recursive: true });
  writeFileSync(
    join(temp.path, 'package/package.json'),
    JSON.stringify({
      name: '@serverless-jwt/next',
      version: '0.0.0',
      repository: {
        url: 'git+https://github.com/sandrinodm/serverless-jwt.git',
        directory: 'packages/next',
      },
    }),
  );
  for (const name of ['next-compat.d.ts', 'sharp-compat.d.cts', 'index.d.mts']) {
    writeFileSync(join(temp.path, 'package/dist', name), 'export {};');
  }

  const tarball = join(temp.path, 'next.tgz');
  execFileSync('tar', ['-czf', tarball, '-C', temp.path, 'package']);
  const validated = validatePackage(tarball);
  expect(validated.manifest.name).toBe('@serverless-jwt/next');
  expect(validated.declarationCompanions).toEqual([
    'package/dist/next-compat.d.ts',
    'package/dist/sharp-compat.d.cts',
  ]);
  expect(validated.names).toEqual(
    expect.arrayContaining([...validated.declarationCompanions, 'package/dist/index.d.mts']),
  );
  writeFileSync(join(temp.path, 'package/dist/unreviewed.d.ts'), 'export {};');
  execFileSync('tar', ['-czf', tarball, '-C', temp.path, 'package']);
  expect(() => validatePackage(tarball)).toThrow('Source shipped: package/dist/unreviewed.d.ts');
});

/**
 * Astro's audited type-only payload is an exact hashed inventory, not a general source allowance.
 */
it.each(['valid', 'changed bytes', 'unreviewed declaration', 'raw source', 'wrong profile'])(
  'validates the exact Astro declaration companion inventory: %s',
  (scenario) => {
    using temp = mkdtempDisposableSync(join(tmpdir(), 'package-astro-companions-'));
    const root = join(temp.path, 'package');
    mkdirSync(join(root, 'dist/type-repair/vendor'), { recursive: true });
    mkdirSync(join(root, 'dist/type-repair/payloads'), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: '@serverless-jwt/astro',
        version: '0.0.0',
        repository: {
          url: 'git+https://github.com/sandrinodm/serverless-jwt.git',
          directory: 'packages/astro',
        },
      }),
    );
    const content = 'export interface Genuine { readonly value: string; }\n';
    const sha256 = createHash('sha256').update(content).digest('hex');
    const profile = {
      astroVersion: scenario === 'wrong profile' ? '7.4.6' : '7.4.5',
      unstorage: { version: '1.17.6' },
      markdown: { version: '7.3.5', repairs: [] },
      assets: [{ path: 'vendor/exact.d.ts', sha256 }],
      repairs: [{ source: 'payloads/client.d.ts', sha256 }],
      generated: [{ source: 'vendor/options.d.mts', sha256 }],
    };
    for (const file of ['vendor/exact.d.ts', 'payloads/client.d.ts', 'vendor/options.d.mts']) {
      writeFileSync(join(root, 'dist/type-repair', file), content);
    }

    if (scenario === 'changed bytes') {
      writeFileSync(join(root, 'dist/type-repair/vendor/exact.d.ts'), 'export {};');
    }

    if (scenario === 'unreviewed declaration') {
      writeFileSync(join(root, 'dist/type-repair/vendor/unreviewed.d.ts'), content);
    }

    if (scenario === 'raw source') {
      profile.assets.push({ path: 'vendor/raw.ts', sha256 });
      writeFileSync(join(root, 'dist/type-repair/vendor/raw.ts'), content);
    }

    writeFileSync(join(root, 'dist/type-repair/manifest.json'), JSON.stringify(profile));
    const tarball = join(temp.path, 'astro.tgz');
    execFileSync('tar', ['-czf', tarball, '-C', temp.path, 'package']);
    if (scenario === 'valid') {
      expect(validatePackage(tarball).declarationCompanions).toEqual([
        'package/dist/type-repair/vendor/exact.d.ts',
        'package/dist/type-repair/payloads/client.d.ts',
        'package/dist/type-repair/vendor/options.d.mts',
      ]);
    } else {
      expect(() => validatePackage(tarball)).toThrow(
        scenario === 'changed bytes'
          ? 'digest differs'
          : scenario === 'unreviewed declaration'
            ? 'Source shipped'
            : scenario === 'raw source'
              ? 'Invalid Astro declaration companion path'
              : 'Unexpected Astro repair SDK profile',
      );
    }
  },
);
