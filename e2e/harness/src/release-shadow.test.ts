import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vite-plus/test';

import { outputDigest } from './cache.ts';
import { internalImports, resolvedInternalImports } from './release-imports.ts';
import { attestNativeOutput } from './release-outputs.ts';
import {
  assertPreparedReleaseResolution,
  assertReleaseResolution,
  snapshotApplication,
  tarballInventory,
} from './release.ts';

/**
 * Real public package archives are packed from the distributions built by ordinary CI preparation.
 */
let packed: ReturnType<typeof mkdtempDisposableSync>;
/**
 * Native proof uses the exact packed core and AWS wrapper, never a synthetic SDK or verifier.
 */
let artifacts: ReturnType<typeof tarballInventory>;

beforeAll(() => {
  packed = mkdtempDisposableSync(join(tmpdir(), 'jwt-real-shadow-artifacts-'));
  for (const name of ['jwt-verifier', 'aws-lambda']) {
    execFileSync(
      'pnpm',
      [
        '--dir',
        resolve(import.meta.dirname, '../../../packages', name),
        '--ignore-scripts',
        'pack',
        '--pack-destination',
        packed.path,
      ],
      { stdio: 'pipe', timeout: 30_000 },
    );
  }

  artifacts = tarballInventory(packed.path);
}, 60_000);
afterAll(() => packed?.[Symbol.dispose]());

/**
 * Installs unchanged real tarball entries and their exact origins without performing a registry
 * install.
 */
function install(app: string): void {
  mkdirSync(app);
  const packages: Record<string, unknown> = {};
  for (const artifact of artifacts) {
    const path = 'node_modules/' + artifact.name;
    mkdirSync(join(app, path), { recursive: true });
    execFileSync('tar', ['-xzf', artifact.path, '--strip-components=1', '-C', join(app, path)]);
    packages[path] = {
      resolved: 'file:' + relative(app, artifact.path),
      integrity: artifact.integrity,
      version: artifact.version,
    };
  }

  writeFileSync(
    join(app, 'package.json'),
    JSON.stringify({ type: 'module', dependencies: { '@serverless-jwt/aws-lambda': '0.0.0' } }),
  );
  writeFileSync(join(app, 'package-lock.json'), JSON.stringify({ packages }));
  // The external third-party dependency is not an internal package or a workspace core fallback.
  symlinkSync(
    resolve(import.meta.dirname, '../../../packages/jwt-verifier/node_modules/jose'),
    join(app, 'node_modules/jose'),
    'dir',
  );
}

it.each([
  'root',
  'compiled',
  'application-deep',
  'application-constructed',
  'outside-symlink',
  'misleading-manifest',
] as const)(
  'rejects actual native core execution through an unrecorded %s package location',
  (position) => {
    using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-real-shadow-'));
    const app = join(directory.path, 'app');
    install(app);
    expect(() => assertReleaseResolution(app, artifacts)).not.toThrow();
    const aws = join(app, 'node_modules/@serverless-jwt/aws-lambda');
    const importer = position.startsWith('application-')
      ? join(app, 'runtime/handlers/deep/entry.mjs')
      : join(aws, 'dist/index.mjs');
    const location =
      position === 'root'
        ? aws
        : position.startsWith('application-')
          ? join(app, 'runtime/handlers')
          : join(aws, 'dist');
    const shadow = join(location, 'node_modules/@serverless-jwt/jwt-verifier');
    const copy = position === 'outside-symlink' ? join(directory.path, 'outside-core') : shadow;
    cpSync(join(app, 'node_modules/@serverless-jwt/jwt-verifier'), copy, { recursive: true });
    writeFileSync(
      join(copy, 'dist/adapter.mjs'),
      readFileSync(join(copy, 'dist/adapter.mjs'), 'utf8') +
        '\nglobalThis.__shadowExecuted = true;\n',
    );
    if (position === 'outside-symlink') {
      mkdirSync(join(location, 'node_modules/@serverless-jwt'), { recursive: true });
      symlinkSync(copy, shadow, 'dir');
      mkdirSync(join(directory.path, 'node_modules'), { recursive: true });
      symlinkSync(
        resolve(import.meta.dirname, '../../../packages/jwt-verifier/node_modules/jose'),
        join(directory.path, 'node_modules/jose'),
        'dir',
      );
    }

    if (position === 'misleading-manifest') {
      const path = join(copy, 'package.json');
      const manifest = JSON.parse(readFileSync(path, 'utf8'));
      manifest.name = 'misleading-third-party';
      writeFileSync(path, JSON.stringify(manifest));
    }

    if (position.startsWith('application-')) {
      mkdirSync(join(app, 'runtime/handlers/deep'), { recursive: true });
      writeFileSync(
        importer,
        position === 'application-constructed'
          ? 'const scope = "@serverless-jwt/"; export const createGuard = (await import(scope + "jwt-verifier/adapter")).createGuard;'
          : 'export { createGuard } from "@serverless-jwt/jwt-verifier/adapter";',
      );
    }

    for (const node of new Set(
      [process.execPath, process.env.MIN_NODE_BIN].filter((value): value is string =>
        Boolean(value),
      ),
    )) {
      const proof = execFileSync(
        node,
        [
          '--input-type=module',
          '-e',
          'const value = await import(process.argv[1]); process.stdout.write(JSON.stringify({executed:globalThis.__shadowExecuted === true,actualExport: typeof (value.createGuard ?? value.withJwt.apiGatewayV2)}));',
          importer,
        ],
        { cwd: app, encoding: 'utf8', timeout: 5_000 },
      );
      expect(JSON.parse(proof)).toEqual({ executed: true, actualExport: 'function' });
    }

    expect(() => assertReleaseResolution(app, artifacts)).toThrow(
      /Unrecorded physical internal package|escaped isolated app|Physical internal package name differs/,
    );
  },
  15_000,
);

it('rejects manifestless internal directories and terminates recursive directory cycles', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-real-shadow-shape-'));
  const app = join(directory.path, 'app');
  install(app);
  mkdirSync(join(app, 'source/deep'), { recursive: true });
  symlinkSync(join(app, 'source'), join(app, 'source/deep/cycle'), 'dir');
  expect(() => assertReleaseResolution(app, artifacts)).not.toThrow();
  const shadow = join(app, 'source/deep/node_modules/@serverless-jwt/jwt-verifier');
  mkdirSync(shadow, { recursive: true });
  expect(() => assertReleaseResolution(app, artifacts)).toThrow(
    /Physical internal package has no manifest|Unrecorded physical internal package/,
  );
  rmSync(shadow, { recursive: true });
});

it('resolves decoded compiled ESM subpaths with import conditions independently of CommonJS', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-native-export-conditions-'));
  const core = join(directory.path, 'node_modules/@serverless-jwt/condition-control');
  mkdirSync(core, { recursive: true });
  writeFileSync(
    join(core, 'package.json'),
    JSON.stringify({
      name: '@serverless-jwt/condition-control',
      type: 'module',
      exports: { './adapter': { import: './actual-import.mjs', require: './actual-require.cjs' } },
    }),
  );
  writeFileSync(join(core, 'actual-import.mjs'), 'export const condition = "import";');
  writeFileSync(join(core, 'actual-require.cjs'), 'exports.condition = "require";');
  const compiled = join(directory.path, 'compiled/deep/handler.mjs');
  mkdirSync(join(directory.path, 'compiled/deep'), { recursive: true });
  // Escaping defeats text matching; the native parser decodes the full executable subpath.
  writeFileSync(
    compiled,
    'export { condition } from "@serverless' +
      String.fromCharCode(92) +
      'u002djwt/condition-control/adapter";',
  );
  const cjs = join(directory.path, 'compiled/deep/handler.cjs');
  writeFileSync(cjs, 'module.exports = require("@serverless-jwt/condition-control/adapter");');
  const dynamic = join(directory.path, 'compiled/deep/dynamic.mjs');
  writeFileSync(
    dynamic,
    'export const condition = (await import(`@serverless' +
      String.fromCharCode(92) +
      'u002djwt/condition-control/adapter`)).condition;',
  );
  expect(readFileSync(compiled, 'utf8').includes('@serverless-jwt/')).toBe(false);
  expect(readFileSync(dynamic, 'utf8').includes('@serverless-jwt/')).toBe(false);
  const results = resolvedInternalImports(internalImports([compiled, cjs, dynamic]));
  expect(
    results.map((entry) => ({ importer: entry.importer, mode: entry.mode, file: entry.resolved })),
  ).toEqual([
    { importer: compiled, mode: 'import', file: join(core, 'actual-import.mjs') },
    { importer: cjs, mode: 'require', file: join(core, 'actual-require.cjs') },
    { importer: dynamic, mode: 'import', file: join(core, 'actual-import.mjs') },
  ]);
  const actual = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'const value=await import(process.argv[1]);process.stdout.write(value.condition);',
      compiled,
    ],
    { encoding: 'utf8', timeout: 5_000 },
  );
  expect(actual).toBe('import');
});

it.each(['unicode', 'line-continuation', 'octal', 'identity'] as const)(
  'preserves native CommonJS %s package literals in bounded candidate analysis',
  (style) => {
    using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-cjs-literal-'));
    const core = join(directory.path, 'node_modules/@serverless-jwt/condition-control');
    mkdirSync(core, { recursive: true });
    writeFileSync(
      join(core, 'package.json'),
      JSON.stringify({
        name: '@serverless-jwt/condition-control',
        exports: { './adapter': { require: './native.cjs' } },
      }),
    );
    writeFileSync(join(core, 'native.cjs'), 'module.exports = { condition: "require" };');
    const slash = String.fromCharCode(92);
    const specifier =
      style === 'unicode'
        ? slash + 'u0040serverless-jwt/condition-control/adapter'
        : style === 'octal'
          ? slash + '100serverless-jwt/condition-control/adapter'
          : style === 'identity'
            ? '@serverless' + slash + '-jwt/condition-control/adapter'
            : '@serverless-' + slash + String.fromCharCode(10) + 'jwt/condition-control/adapter';
    const importer = join(directory.path, 'entry.cjs');
    writeFileSync(importer, 'module.exports = require("' + specifier + '");');
    expect(readFileSync(importer, 'utf8').includes('@serverless-jwt/')).toBe(false);
    const nativeAnalysis = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          'const {internalImports,resolvedInternalImports}=await import(process.argv[1]);const imports=internalImports([process.argv[2]]);process.stdout.write(JSON.stringify({imports,resolved:resolvedInternalImports(imports)}));',
          new URL('./release-imports.ts', import.meta.url).href,
          importer,
        ],
        { encoding: 'utf8', timeout: 5_000 },
      ),
    );
    const imports = nativeAnalysis.imports;
    expect(imports).toEqual([
      { importer, specifier: '@serverless-jwt/condition-control/adapter', mode: 'require' },
    ]);
    expect(nativeAnalysis.resolved[0]?.resolved).toBe(join(core, 'native.cjs'));
    const native = execFileSync(
      process.execPath,
      ['-e', 'process.stdout.write(require(process.argv[1]).condition);', importer],
      { encoding: 'utf8', timeout: 5_000 },
    );
    expect(native).toBe('require');
  },
);
it('rejects a legacy Node-resolvable scoped file even with a constructed CommonJS specifier', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-scoped-file-shadow-'));
  const app = join(directory.path, 'app');
  install(app);
  expect(() => assertReleaseResolution(app, artifacts)).not.toThrow();
  const scope = join(app, 'runtime/deep/node_modules/@serverless-jwt');
  mkdirSync(scope, { recursive: true });
  writeFileSync(
    join(scope, 'jwt-verifier.js'),
    'globalThis.__fileShadow=true;module.exports={verifyToken(){}};',
  );
  const importer = join(app, 'runtime/deep/entry.cjs');
  writeFileSync(
    importer,
    'const scope="@serverless-jwt/";const value=require(scope+"jwt-verifier");process.stdout.write(JSON.stringify({executed:globalThis.__fileShadow,kind:typeof value.verifyToken}));',
  );
  const proof = execFileSync(process.execPath, [importer], { encoding: 'utf8', timeout: 5_000 });
  expect(JSON.parse(proof)).toEqual({ executed: true, kind: 'function' });
  expect(() => assertReleaseResolution(app, artifacts)).toThrow(
    'Physical internal package has no manifest',
  );
});

it('attests native compiled subpath aliases only through their exact app-owned locked package', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-derived-native-alias-'));
  const app = join(directory.path, 'app');
  install(app);
  const scope = join(app, 'compiled/node_modules/@serverless-jwt');
  mkdirSync(scope, { recursive: true });
  const core = join(app, 'node_modules/@serverless-jwt/jwt-verifier');
  const alias = join(scope, 'core-derived');
  symlinkSync(core, alias, 'dir');
  const importer = join(app, 'compiled/entry.mjs');
  writeFileSync(importer, 'export { createGuard } from "@serverless-jwt/core-derived/adapter";');
  const actual = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'const value=await import(process.argv[1]);process.stdout.write(typeof value.createGuard);',
      importer,
    ],
    { encoding: 'utf8', timeout: 5_000 },
  );
  expect(actual).toBe('function');
  const attested = assertReleaseResolution(app, artifacts);
  const artifact = artifacts.find((entry) => entry.name === '@serverless-jwt/jwt-verifier');
  expect(attested).toEqual([
    {
      alias: 'compiled/node_modules/@serverless-jwt/core-derived',
      package: '@serverless-jwt/jwt-verifier',
      installed: core,
      artifact: artifact?.path,
      integrity: artifact?.integrity,
    },
  ]);
  vi.stubEnv('E2E_FROM_TARBALLS', packed.path);
  const snapshot = snapshotApplication(app, join(directory.path, 'snapshot'));
  expect(() => assertReleaseResolution(snapshot, artifacts)).not.toThrow();
  const misleading = join(scope, 'aws-lambda');
  symlinkSync(core, misleading, 'dir');
  expect(() => assertReleaseResolution(app, artifacts)).toThrow(
    'Physical internal package name differs',
  );
  rmSync(misleading);
  // An independent unrecorded copy is not an alias even when its initial bytes match exactly.
  rmSync(alias);
  cpSync(core, alias, { recursive: true });
  expect(() => assertReleaseResolution(app, artifacts)).toThrow(
    'Unrecorded physical internal package',
  );
  rmSync(alias, { recursive: true });
  symlinkSync(core, alias, 'dir');
  const extra = join(core, 'dist/unpacked.mjs');
  writeFileSync(extra, 'export const unrecorded = true;');
  expect(() => assertReleaseResolution(app, artifacts)).toThrow(
    'Installed internal file inventory differs',
  );
  rmSync(extra);
  const disguised = join(core, 'node_modules');
  writeFileSync(disguised, 'unpacked file cannot masquerade as a dependency directory');
  expect(() => assertReleaseResolution(app, artifacts)).toThrow(
    'Installed internal file inventory differs',
  );
  rmSync(disguised);
  const target = join(core, 'dist/adapter.mjs');
  writeFileSync(target, readFileSync(target, 'utf8') + '\nexport const unrecordedChange = true;');
  expect(() => assertReleaseResolution(app, artifacts)).toThrow('differs from supplied artifact');
  expect(() => assertReleaseResolution(snapshot, artifacts)).not.toThrow();
});

it.each(['module-container', 'scope-container', 'ancestor-container', 'missing-manifest'] as const)(
  'rejects an unrecorded logical lookup through a %s alias after ordinary storage traversal',
  (layout) => {
    using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-logical-lookup-'));
    const app = join(directory.path, 'app');
    install(app);
    const storage = join(app, 'aaa-storage');
    const scope =
      layout === 'ancestor-container'
        ? join(app, '@serverless-jwt')
        : join(storage, '@serverless-jwt');
    const copy = join(scope, 'jwt-verifier');
    cpSync(join(app, 'node_modules/@serverless-jwt/jwt-verifier'), copy, { recursive: true });
    const manifest = join(copy, 'package.json');
    if (layout === 'missing-manifest') {
      rmSync(manifest);
    } else {
      const value = JSON.parse(readFileSync(manifest, 'utf8'));
      value.name = 'ordinary-third-party';
      writeFileSync(manifest, JSON.stringify(value));
    }

    mkdirSync(join(app, 'runtime'), { recursive: true });
    if (layout === 'scope-container') {
      mkdirSync(join(app, 'runtime/node_modules'));
      symlinkSync(scope, join(app, 'runtime/node_modules/@serverless-jwt'), 'dir');
    } else {
      symlinkSync(
        layout === 'ancestor-container' ? app : storage,
        join(app, 'runtime/node_modules'),
        'dir',
      );
    }

    // Physical validation must not depend on evaluating a constructed runtime import.
    writeFileSync(
      join(app, 'runtime/entry.mjs'),
      'export const name = ["@serverless-jwt", "jwt-verifier/adapter"].join("/");',
    );
    expect(() => assertReleaseResolution(app, artifacts)).toThrow(
      /Unrecorded physical internal package|Physical internal package has no manifest/,
    );
  },
);

it('terminates ordinary ancestor cycles while retaining lawful locked-package scope aliases', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-lawful-lookup-cycle-'));
  const app = join(directory.path, 'app');
  install(app);
  mkdirSync(join(app, 'runtime/deep'), { recursive: true });
  symlinkSync(app, join(app, 'runtime/deep/ancestor'), 'dir');
  symlinkSync(join(app, 'node_modules'), join(app, 'runtime/node_modules'), 'dir');
  expect(() => assertReleaseResolution(app, artifacts)).not.toThrow();
});

it('revalidates registered native runtime subsets, exact manifests and snapshots without permitting raw copies', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-native-runtime-subset-'));
  const app = join(directory.path, 'app');
  install(app);
  const path = '.vercel/output/functions/api/me.func/node_modules/@serverless-jwt/jwt-verifier';
  const copy = join(app, path);
  const core = join(app, 'node_modules/@serverless-jwt/jwt-verifier');
  cpSync(core, copy, { recursive: true });
  rmSync(join(copy, 'README.md'));
  rmSync(join(copy, 'LICENSE'));
  // The actual producer traces runtime files and preserves the exact published manifest.
  const removeTypes = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        removeTypes(file);
      } else if (entry.name.endsWith('.d.mts')) {
        rmSync(file);
      }
    }
  };
  removeTypes(copy);
  expect(() => assertReleaseResolution(app, artifacts)).toThrow(
    'Unrecorded physical internal package',
  );
  const key = 'a'.repeat(64);
  const native = attestNativeOutput(app, 'vercel', key, artifacts, [copy]);
  assert.ok(native);
  const registered = native.packages[0];
  assert.ok(registered);
  expect(registered.path).toBe(path);
  expect(() =>
    assertReleaseResolution(app, artifacts, { ...native, producer: 'unregistered' } as never),
  ).toThrow('Unregistered native output producer');
  expect(() => assertReleaseResolution(app, artifacts, { ...native, output: 'runtime' })).toThrow(
    'Unregistered native output path',
  );
  expect(() => assertReleaseResolution(app, artifacts, { ...native, lock: 'changed' })).toThrow(
    'Native build graph identity changed',
  );
  expect(() =>
    assertReleaseResolution(app, artifacts, {
      ...native,
      packages: [{ ...registered, path: '../outside' }],
    }),
  ).toThrow('outside registered output');

  expect(() => assertReleaseResolution(app, artifacts, native)).not.toThrow();
  writeFileSync(join(app, '.e2e-artifacts.json'), JSON.stringify({ key, native }));
  vi.stubEnv('E2E_FROM_TARBALLS', packed.path);
  const snapshot = snapshotApplication(app, join(directory.path, 'snapshot'));
  expect(() => assertPreparedReleaseResolution(snapshot, artifacts)).not.toThrow();
  expect(() => assertReleaseResolution(snapshot, artifacts)).toThrow(
    'Unrecorded physical internal package',
  );
  const extra = join(copy, 'dist/unpacked.mjs');
  writeFileSync(extra, 'export const extra = true;');
  expect(() => assertPreparedReleaseResolution(app, artifacts)).toThrow(
    'Native build output changed',
  );
  expect(() => attestNativeOutput(app, 'vercel', key, artifacts, [copy])).toThrow('unpacked file');
  rmSync(extra);
  const runtime = join(copy, 'dist/adapter.mjs');
  const original = readFileSync(runtime);
  writeFileSync(runtime, 'export const changed = true;');
  expect(() => attestNativeOutput(app, 'vercel', key, artifacts, [copy])).toThrow(
    'differs from supplied artifact',
  );
  writeFileSync(runtime, original);
  rmSync(join(copy, 'dist/bearer.mjs'));
  expect(() => attestNativeOutput(app, 'vercel', key, artifacts, [copy])).toThrow('ENOENT');
  cpSync(join(core, 'dist/bearer.mjs'), join(copy, 'dist/bearer.mjs'));
  const nested = join(copy, 'node_modules/@serverless-jwt/jwt-verifier');
  cpSync(core, nested, { recursive: true });
  expect(() => attestNativeOutput(app, 'vercel', key, artifacts, [copy])).toThrow(
    'nested dependencies',
  );
  rmSync(join(copy, 'node_modules'), { recursive: true });
  const manifest = join(copy, 'package.json');
  const published = readFileSync(manifest);
  writeFileSync(
    manifest,
    JSON.stringify({ ...JSON.parse(published.toString()), version: 'unrecorded' }),
  );
  expect(() => attestNativeOutput(app, 'vercel', key, artifacts, [copy])).toThrow(
    'differs from supplied artifact',
  );
  writeFileSync(manifest, published);
  rmSync(runtime);
  symlinkSync(join(core, 'dist/adapter.mjs'), runtime);
  expect(() => attestNativeOutput(app, 'vercel', key, artifacts, [copy])).toThrow('symlink');
  rmSync(runtime);
  cpSync(join(core, 'dist/adapter.mjs'), runtime);
  const unlisted = join(
    app,
    '.vercel/output/functions/other.func/node_modules/@serverless-jwt/jwt-verifier',
  );
  cpSync(core, unlisted, { recursive: true });
  // Even a recomputed output digest cannot expand the explicitly registered package set.
  expect(() =>
    assertReleaseResolution(app, artifacts, {
      ...native,
      digest: outputDigest(join(app, '.vercel/output')),
    }),
  ).toThrow('Unrecorded physical internal package');
  expect(() => assertPreparedReleaseResolution(snapshot, artifacts)).not.toThrow();
});
