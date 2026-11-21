import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { parse } from 'yaml';

import type { NativeOutput } from './release-outputs.ts';

import { applyNetlifyLoggingPatch } from '../../../scripts/netlify-logging.ts';
import { applyRouterLoggingPatch } from '../../../scripts/router-logging.ts';
import {
  applySolidStartSdkPatch,
  assertSolidStartSdkPatch,
} from '../../../scripts/solidstart-sdk.ts';
import { outputDigest } from './cache.ts';
import { privateLogs } from './logs.ts';
import { prepareNetlifyTools } from './netlify-tools.ts';
import { internalImports, resolvedInternalImports } from './release-imports.ts';
import { attestNativeOutput, nativeOutputPath, validateNativeOutput } from './release-outputs.ts';

/**
 * Repository tooling and source CA stay outside isolated installed application roots.
 */
const repository = resolve(import.meta.dirname, '../../..');

/**
 * Exact supplied tarball metadata used to reject registry and workspace package resolution.
 */
export interface Artifact {
  /**
   * Public package name read from its packed manifest.
   */
  readonly name: string;

  /**
   * Exact package version inside the immutable tarball.
   */
  readonly version: string;

  /**
   * Canonical absolute supplied file path.
   */
  readonly path: string;

  /**
   * SHA-512 npm integrity of the supplied compressed artifact.
   */
  readonly integrity: string;

  /**
   * Build-cache and mutation-detection digest of the supplied compressed artifact.
   */
  readonly sha256: string;
}

/**
 * A native build may add an app-owned symlink name for an already fully attested installed package.
 */
interface ReleaseAlias {
  /**
   * App-relative native lookup alias, without granting trust to a new physical copy.
   */
  readonly alias: string;

  /**
   * Exact canonical public package identity behind the alias.
   */
  readonly package: string;

  /**
   * App-owned canonical root whose complete file inventory and bytes match the supplied archive.
   */
  readonly installed: string;

  /**
   * Supplied archive origin already verified through the canonical installation's lock entry.
   */
  readonly artifact: string;

  /**
   * Exact compressed-artifact integrity shared with that canonical installation.
   */
  readonly integrity: string;
}

/**
 * Reads the actual packed manifest and hashes every supplied immutable artifact.
 */
export function tarballInventory(directory: string): ReadonlyArray<Artifact> {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.tgz'))
    .map((file) => {
      const path = realpathSync(join(directory, file));
      const manifest = JSON.parse(
        execFileSync('tar', ['-xOf', path, 'package/package.json'], { encoding: 'utf8' }),
      );
      assert.match(manifest.name, /^@serverless-jwt\//, 'Unexpected tarball namespace');
      assert.equal(manifest.private, undefined, 'Private packages cannot enter release mode');
      const data = readFileSync(path);
      return {
        name: manifest.name,
        version: manifest.version,
        path,
        integrity: 'sha512-' + createHash('sha512').update(data).digest('base64'),
        sha256: createHash('sha256').update(data).digest('hex'),
      };
    });
}

/**
 * Resolves all direct catalog/workspace specifiers and pins transitive internals to supplied files.
 */
export function releaseManifest(
  input: Readonly<Record<string, unknown>>,
  catalog: Readonly<Record<string, string>>,
  artifacts: ReadonlyArray<Artifact>,
): Record<string, unknown> {
  const manifest: Record<string, unknown> = structuredClone(input);
  const direct = new Set<string>();
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const values = (manifest[section] ?? {}) as Record<string, string>;
    for (const [name, specifier] of Object.entries(values)) {
      direct.add(name);
      if (name.startsWith('@serverless-jwt/')) {
        const artifact = artifacts.find((entry) => entry.name === name);
        assert.ok(artifact, 'Missing supplied tarball for ' + name);
        values[name] = 'file:' + artifact.path;
      } else if (specifier.startsWith('catalog:')) {
        assert.equal(specifier, 'catalog:', 'Named catalogs must be explicitly supported');
        assert.ok(catalog[name], 'Unresolved catalog dependency ' + name);
        values[name] = catalog[name];
      } else {
        assert.ok(
          !specifier.startsWith('workspace:'),
          'Nonpublic workspace dependency cannot enter release mode',
        );
      }
    }

    if (manifest[section]) {
      manifest[section] = values;
    }
  }

  manifest.overrides = Object.fromEntries(
    artifacts.map((artifact) => [
      artifact.name,
      direct.has(artifact.name) ? '$' + artifact.name : 'file:' + artifact.path,
    ]),
  );
  if (manifest.name === '@serverless-jwt-internal/astro') {
    const scripts = (manifest.scripts ?? {}) as Record<string, string>;
    assert.equal(
      scripts['prepare:peers'],
      'pnpm --filter @serverless-jwt/astro... build',
      'Reassess Astro installed preparation after workspace script changes',
    );
    const repair =
      "node --input-type=module -e \"import { repairAstroTypes } from '@serverless-jwt/astro/type-repair'; repairAstroTypes({ installationRoot: '../../..' })\"";
    assert.equal(
      scripts['repair:types'],
      repair,
      'Reassess Astro installed repair after workspace script changes',
    );
    // Supplied artifacts are already built and fully attested; only their public imports are prepared here.
    scripts['prepare:peers'] =
      "node --input-type=module -e \"await import('@serverless-jwt/astro'); await import('@serverless-jwt/astro/build'); await import('@serverless-jwt/astro/type-repair')\"";
    scripts['repair:types'] = repair.replace(
      "installationRoot: '../../..'",
      "installationRoot: '.'",
    );
  }

  delete manifest.devEngines;
  return manifest;
}

/**
 * Walks the complete installed/app tree, including node_modules at every possible importer depth.
 */
function physicalPackages(app: string): {
  readonly packages: ReadonlyArray<string>;
  readonly modules: ReadonlyArray<string>;
} {
  const packages = new Set<string>([app]);
  const modules = new Set<string>();
  const visited = new Set<string>();

  /**
   * Logical Node lookup roles survive canonical deduplication of ordinary storage and cycles.
   */
  const inspectScope = (scope: string): void => {
    if (!existsSync(scope)) {
      return;
    }

    assert.ok(statSync(scope).isDirectory(), 'Physical internal package has no manifest');
    for (const entry of readdirSync(scope)) {
      const installed = join(scope, entry);
      assert.ok(
        statSync(installed).isDirectory() && existsSync(join(installed, 'package.json')),
        'Physical internal package has no manifest',
      );
      assert.ok(
        realpathSync(installed).startsWith(realpathSync(app) + sep),
        'Internal package escaped isolated app',
      );
      packages.add(installed);
    }
  };

  /**
   * Checks each direct lookup before skipping an already visited canonical directory. Inspecting
   * the scope without recursively following it also covers a node_modules link to an ancestor.
   */
  const walk = (directory: string): void => {
    inspectScope(join(directory, 'node_modules/@serverless-jwt'));
    if (basename(directory) === 'node_modules') {
      inspectScope(join(directory, '@serverless-jwt'));
    }

    if (
      basename(directory) === '@serverless-jwt' &&
      basename(dirname(directory)) === 'node_modules'
    ) {
      inspectScope(directory);
    }

    if (existsSync(join(directory, 'package.json'))) {
      packages.add(directory);
    }

    const canonical = realpathSync(directory);
    if (visited.has(canonical)) {
      return;
    }

    visited.add(canonical);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const info = entry.isSymbolicLink() ? statSync(path) : entry;
      if (
        basename(directory) === '@serverless-jwt' &&
        basename(dirname(directory)) === 'node_modules'
      ) {
        assert.ok(info.isDirectory(), 'Physical internal package has no manifest');
      }

      if (info.isDirectory()) {
        walk(path);
      } else if (
        info.isFile() &&
        /\.[cm]?[jt]sx?$/u.test(entry.name) &&
        !/(?:\.d\.[cm]?ts|\.(?:test|spec)\.[cm]?tsx?)$/u.test(entry.name)
      ) {
        modules.add(realpathSync(path));
      }
    }
  };
  walk(app);
  return { packages: [...packages], modules: [...modules] };
}

/**
 * Asserts every installed internal package's lock entry, real path, manifest and packed bytes.
 */
export function assertReleaseResolution(
  app: string,
  artifacts: ReadonlyArray<Artifact>,
  native?: NativeOutput,
): ReadonlyArray<ReleaseAlias> {
  const lock = JSON.parse(readFileSync(join(app, 'package-lock.json'), 'utf8')) as {
    readonly packages: Readonly<
      Record<
        string,
        { readonly resolved?: string; readonly integrity?: string; readonly link?: boolean }
      >
    >;
  };
  const internals = Object.entries(lock.packages).filter(([path]) =>
    /(?:^|\/)node_modules\/@serverless-jwt\//.test(path),
  );
  assert.ok(internals.length > 0, 'No internal package was installed');
  const root = realpathSync(app);
  const layout = physicalPackages(app);
  const packages = layout.packages;
  const derived = native ? validateNativeOutput(app, artifacts, native) : [];
  const verified = new Set<string>(derived);
  const aliases: ReleaseAlias[] = [];
  for (const installed of packages.slice(1)) {
    const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
    if (
      manifest.name?.startsWith('@serverless-jwt/') ||
      /(?:^|\/)node_modules\/@serverless-jwt\//u.test(installed)
    ) {
      const path = relative(app, installed).split(sep).join('/');
      const canonical = realpathSync(installed);
      assert.ok(canonical.startsWith(root + sep), 'Internal package escaped isolated app');
      const recorded = internals.some(([locked]) => locked === path);
      const logicalName = '@serverless-jwt/' + basename(installed);
      if (derived.includes(canonical)) {
        assert.equal(manifest.name, logicalName, 'Physical internal package name differs');
        continue;
      }

      if (!recorded) {
        const origin = internals.find(([locked]) => realpathSync(join(app, locked)) === canonical);
        assert.ok(
          origin && resolve(installed) !== canonical,
          'Unrecorded physical internal package',
        );
        const artifact = artifacts.find((candidate) => candidate.name === manifest.name);
        assert.ok(artifact, 'Installed internal alias has no supplied artifact');
        // Unknown native aliases may retain the canonical identity; existing public names cannot change it.
        if (artifacts.some((candidate) => candidate.name === logicalName)) {
          assert.equal(manifest.name, logicalName, 'Physical internal package name differs');
        }

        aliases.push({
          alias: path,
          package: artifact.name,
          installed: canonical,
          artifact: artifact.path,
          integrity: artifact.integrity,
        });
      } else {
        assert.equal(manifest.name, logicalName, 'Physical internal package name differs');
      }
    }
  }

  for (const [path, entry] of internals) {
    const installed = realpathSync(join(app, path));
    assert.ok(
      installed.startsWith(realpathSync(app) + sep),
      'Internal package escaped isolated app',
    );
    assert.equal(entry.link, undefined, 'Workspace symlink entered release mode');
    const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
    const artifact = artifacts.find((candidate) => candidate.name === manifest.name);
    assert.ok(artifact, 'Installed internal package has no supplied artifact');
    assert.equal(manifest.version, artifact.version, 'Installed internal version drifted');
    assert.ok(
      typeof entry.resolved === 'string' && entry.resolved.startsWith('file:'),
      'Internal package resolved outside supplied tarballs',
    );
    assert.equal(
      realpathSync(resolve(app, entry.resolved.slice(5))),
      artifact.path,
      'Internal package resolved outside supplied tarballs',
    );
    assert.equal(entry.integrity, artifact.integrity, 'Internal tarball integrity differs');
    assert.equal(
      createHash('sha256').update(readFileSync(artifact.path)).digest('hex'),
      artifact.sha256,
      'Tarball changed during installation',
    );
    verified.add(installed);
    // Integrity in the lock alone cannot prove installed files: compare every packed file byte.
    const names = execFileSync('tar', ['-tzf', artifact.path], { encoding: 'utf8' })
      .split('\n')
      .filter((name) => name && !name.endsWith('/'));
    const expectedNames = names.map((name) => name.slice('package/'.length)).sort();
    const installedNames: string[] = [];
    const visited = new Set<string>();
    /**
     * Rejects additional executable/declaration files while dependencies retain their own package
     * attestation.
     */
    const inventory = (directory: string): void => {
      const canonical = realpathSync(directory);
      assert.ok(
        canonical.startsWith(installed + sep) || canonical === installed,
        'Internal directory escaped installed package',
      );
      assert.ok(!visited.has(canonical), 'Internal directory cycle entered installed package');
      visited.add(canonical);
      for (const file of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, file.name);
        const directoryEntry = statSync(path).isDirectory();
        if (file.name === 'node_modules' && directoryEntry) {
          continue;
        }

        if (directoryEntry) {
          inventory(path);
        } else {
          installedNames.push(relative(installed, path).split(sep).join('/'));
        }
      }
    };
    inventory(installed);
    installedNames.sort();
    assert.ok(
      installedNames.length === expectedNames.length &&
        installedNames.every((name, index) => name === expectedNames[index]),
      'Installed internal file inventory differs from supplied artifact',
    );
    for (const name of names) {
      assert.ok(
        name.startsWith('package/') && !name.split('/').includes('..'),
        'Unsafe packed file path',
      );
      const expected: Buffer = execFileSync('tar', ['-xOf', artifact.path, name]);
      const file = join(installed, name.slice('package/'.length));
      assert.ok(
        realpathSync(file).startsWith(installed + sep),
        'Internal file escaped installed package',
      );
      assert.deepEqual(
        readFileSync(file),
        expected,
        'Installed internal file differs from supplied artifact',
      );
    }
  }

  /**
   * Resolves identity from fully attested bytes; only recorded app-owned aliases may introduce a
   * new name.
   */
  const assertImporter = (resolved: string, name: string): void => {
    let owner = dirname(resolved);
    while (!existsSync(join(owner, 'package.json')) && owner !== dirname(owner)) {
      owner = dirname(owner);
    }

    assert.ok(verified.has(owner), 'Executable importer resolved an unverified internal package');
    const canonicalName = JSON.parse(readFileSync(join(owner, 'package.json'), 'utf8')).name;
    assert.ok(
      canonicalName === name ||
        (!artifacts.some((artifact) => artifact.name === name) &&
          aliases.some(
            (alias) =>
              '@serverless-jwt/' + basename(alias.alias) === name && alias.installed === owner,
          )),
      'Executable importer resolved a different internal package',
    );
  };
  for (const importer of packages) {
    // Native tracing retains executable subpaths only; their actual import closure is checked below.
    // An unused root export need not be emitted in the runtime-only package subset.
    if (derived.includes(realpathSync(importer))) {
      continue;
    }

    const manifest = JSON.parse(readFileSync(join(importer, 'package.json'), 'utf8'));
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
      ...(importer === app ? manifest.devDependencies : {}),
    };
    for (const name of Object.keys(dependencies).filter((name) =>
      name.startsWith('@serverless-jwt/'),
    )) {
      assertImporter(
        realpathSync(createRequire(join(importer, 'package.json')).resolve(name)),
        name,
      );
    }
  }

  for (const entry of resolvedInternalImports(internalImports(layout.modules))) {
    assertImporter(entry.resolved, entry.specifier.split('/').slice(0, 2).join('/'));
  }

  return aliases;
}

/**
 * Hashes source, lockfile, artifact bytes, runtime and build configuration without generated files.
 */
export function applicationCacheKey(source: string, artifacts: ReadonlyArray<Artifact>): string {
  const hash = createHash('sha256')
    .update(process.version)
    .update(realpathSync(source))
    .update(readFileSync(join(repository, 'pnpm-lock.yaml')));
  for (const name of [
    'tsconfig.base.json',
    'vite.config.ts',
    'pnpm-workspace.yaml',
    'package.json',
    'scripts/e2e-build.mjs',
    'e2e/harness/src/cache.ts',
    'e2e/harness/src/release.ts',
    'e2e/harness/src/release-imports.ts',
    'e2e/harness/src/release-outputs.ts',
    'scripts/solidstart-sdk.ts',
    'e2e/solidstart-sdk-patch.json',
    'patches/@solidjs__router@1.0.1.patch',
    'patches/h3@2.0.8.patch',
  ]) {
    hash.update(name).update(readFileSync(join(repository, name)));
  }

  /**
   * Walks deterministic source paths while excluding dependencies and generated runtime output.
   */
  const walk = (directory: string, base = directory): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (
        [
          'node_modules',
          'dist',
          'build',
          '.next',
          '.svelte-kit',
          '.output',
          '.vercel',
          '.netlify',
          '.wrangler',
          '.astro',
          '.nuxt',
          '.nitro',
          '.react-router',
          '.tanstack',
          'next-env.d.ts',
          'routeTree.gen.ts',
        ].includes(entry.name) ||
        entry.name.endsWith('.tsbuildinfo')
      ) {
        continue;
      }

      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path, base);
      } else if (entry.isFile()) {
        hash.update(path.slice(base.length)).update(readFileSync(path));
      }
    }
  };
  hash.update('app:');
  walk(source);
  for (const variable of ['MIN_NODE_BIN', 'DENO_BIN', 'BUN_BIN']) {
    const binary = process.env[variable];
    if (binary) {
      hash
        .update(variable)
        .update(execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 5_000 }));
    }
  }

  if (artifacts.length) {
    for (const artifact of [...artifacts].sort((a, b) => a.name.localeCompare(b.name))) {
      hash.update(artifact.name).update(artifact.sha256);
    }
  } else {
    hash.update('workspace:');
    walk(join(repository, 'packages'));
    for (const name of readdirSync(join(repository, 'packages'))) {
      const built = join(repository, 'packages', name, 'dist');
      if (existsSync(built)) {
        hash.update(name).update(outputDigest(built));
      }
    }
  }

  return hash.digest('hex');
}

/**
 * Prepares one complete installed app outside the workspace before a runtime can spawn it.
 */
export function prepareReleaseApplication(name: string, directory: string, parent: string): string {
  const source = join(repository, 'e2e/apps', name);
  const artifacts = tarballInventory(directory);
  assert.equal(
    new Set(artifacts.map((artifact) => artifact.name)).size,
    artifacts.length,
    'Duplicate package tarballs',
  );
  const key = applicationCacheKey(source, artifacts);
  const target = join(parent, name + '-' + key.slice(0, 16));
  if (existsSync(target)) {
    const saved = JSON.parse(readFileSync(join(target, '.e2e-artifacts.json'), 'utf8'));
    assert.equal(saved.key, key, 'Release staging build identity differs');
    assert.equal(saved.native?.key ?? key, key, 'Native output build identity differs');
    assertReleaseResolution(target, artifacts, saved.native);
    if (name === 'solidstart') {
      assertSolidStartSdkPatch(target);
    }

    return target;
  }

  mkdirSync(target, { recursive: true });
  try {
    cpSync(source, target, {
      recursive: true,
      filter: (path) =>
        ![
          'node_modules',
          'dist',
          'build',
          '.next',
          '.svelte-kit',
          '.output',
          '.vercel',
          '.netlify',
          '.wrangler',
          '.nuxt',
          '.nitro',
          '.astro',
          '.react-router',
          '.tanstack',
        ].includes(basename(path)),
    });
    const workspace = parse(readFileSync(join(repository, 'pnpm-workspace.yaml'), 'utf8')) as {
      readonly catalog: Readonly<Record<string, string>>;
      readonly overrides: Readonly<Record<string, string>>;
    };
    const manifest = releaseManifest(
      JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')),
      workspace.catalog,
      artifacts,
    );
    const security: Record<string, unknown> = {};
    for (const [selector, version] of Object.entries(workspace.overrides)) {
      if (selector === 'vite@*') {
        continue;
      }

      const [parent, dependency] = selector.split('>');
      if (dependency && parent) {
        security[parent] = {
          ...((security[parent] ?? {}) as Record<string, string>),
          [dependency]: version,
        };
      } else {
        security[selector] = version;
      }
    }

    manifest.overrides = { ...security, ...(manifest.overrides as Record<string, string>) };
    // Build scripts may use Vite+, but it must resolve from this installed app, never the workspace.
    const dev = (manifest.devDependencies ?? {}) as Record<string, string>;
    if (name === 'netlify') {
      delete dev['netlify-cli'];
    }

    if (dev.vite?.startsWith('npm:@voidzero-dev/vite-plus-core@')) {
      const native = JSON.parse(
        readFileSync(new URL('../../native-vite.json', import.meta.url), 'utf8'),
      );
      assert.equal(
        dev.vite,
        native.workspaceAlias,
        'Reassess native Vite peer mapping on wrapper updates',
      );
      assert.equal(workspace.catalog['vite-plus'], native.wrapperVersion);
      dev.vite = native.apiVersion;
    }

    manifest.devDependencies = {
      ...dev,
      'vite-plus': workspace.catalog['vite-plus'],
      typescript: workspace.catalog.typescript,
    };
    const scripts = (manifest.scripts ?? {}) as Record<string, string>;
    // Native app types remain checked here. Workspace library-source type tests belong to ready;
    // strict packed declaration compatibility remains the separate unchanged all-package gate.
    if (scripts['test:types']) {
      scripts['test:types'] = scripts['test:types']
        .split(' && ')
        .filter((command) => !command.startsWith('tsc -p ../../../packages/'))
        .join(' && ');
    }

    if (name === 'react-router') {
      scripts['test:types'] =
        scripts['test:types']?.replace(
          'react-router typegen',
          'react-router typegen --config vite.app.config.ts',
        ) ?? '';
    }

    if (name === 'sveltekit') {
      dev.typescript = '6.0.3';
      dev['typescript-native'] = 'npm:typescript@' + workspace.catalog.typescript;
      manifest.devDependencies = { ...dev, 'vite-plus': workspace.catalog['vite-plus'] };
      scripts['test:types'] =
        scripts['test:types']?.replaceAll(
          'tsc -p ',
          'node node_modules/typescript-native/bin/tsc -p ',
        ) ?? '';
    }

    manifest.scripts = scripts;
    // npm owns this graph. pnpm is used only by the native fixture build scripts, never to install.
    writeFileSync(join(target, 'pnpm-workspace.yaml'), 'verifyDepsBeforeRun: false\n');
    writeFileSync(join(target, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    cpSync(join(repository, 'tsconfig.base.json'), join(target, 'tsconfig.e2e-base.json'));
    for (const filename of readdirSync(target).filter(
      (name) => name !== 'tsconfig.e2e-base.json' && /^tsconfig(?:\.[^.]+)?\.json$/u.test(name),
    )) {
      const config = JSON.parse(readFileSync(join(target, filename), 'utf8'));
      if (typeof config.extends === 'string' && config.extends.startsWith('../../../')) {
        config.extends = './tsconfig.e2e-base.json';
      }

      if (Array.isArray(config.extends)) {
        config.extends = config.extends.map((value: string): string =>
          value.startsWith('../../../') ? './tsconfig.e2e-base.json' : value,
        );
      }

      config.exclude = [...(config.exclude ?? []), '**/*.test.ts', '**/*.spec.ts', '**/runtime.ts'];
      writeFileSync(join(target, filename), JSON.stringify(config, null, 2) + '\n');
    }

    if (name === 'tanstack-start') {
      const file = join(target, 'types.mjs');
      const original = readFileSync(file, 'utf8');
      const sourceCheck = original.indexOf(
        "execFileSync(compiler, ['-p', resolve(root, 'packages/tanstack-start/tsconfig.types.json')]",
      );
      assert.ok(
        sourceCheck >= 0,
        'Native type script changed; reassess isolated source-check boundary',
      );
      const end = original.indexOf('console.log(', sourceCheck);
      assert.ok(end > sourceCheck);
      const isolated =
        original
          .slice(0, sourceCheck)
          .replace(
            "const root = resolve(import.meta.dirname, '../../..');",
            'const root = import.meta.dirname;',
          ) + original.slice(end);
      writeFileSync(file, isolated);
      writeFileSync(
        join(target, '.e2e-native-types.json'),
        JSON.stringify(
          {
            originalSha256: createHash('sha256').update(original).digest('hex'),
            stagedSha256: createHash('sha256').update(isolated).digest('hex'),
            nativeChecks: 'unchanged strict TS7 React/Solid generated routes and function contexts',
            separateRequiredGate:
              'pnpm ready retains source type tests; pnpm test:package validates strict exact packed declarations',
          },
          null,
          2,
        ) + '\n',
      );
    }

    // The native CLI builds every framework environment; build() alone omits SSR/Nitro phases.
    // Use its exact createBuilder(..., null).buildApp() boundary with the same native config.
    if (name === 'sveltekit' || name === 'tanstack-start' || name === 'solidstart') {
      const bridge = join(target, '.e2e-vite-build.mjs');
      writeFileSync(
        bridge,
        "import assert from 'node:assert/strict'; import {createBuilder,version} from 'vite-plus'; assert.equal(version,'8.3.5'); const builder=await createBuilder({configFile:process.argv[2]},null); await builder.buildApp();\n",
      );
      const file = join(target, 'build.mjs');
      const original = readFileSync(file, 'utf8');
      let isolated: string;
      if (name === 'sveltekit' || name === 'solidstart') {
        isolated = original.replace(
          "execFileSync('pnpm', ['exec', 'vp', 'build', '--config', 'vite.app.config.ts'],",
          "execFileSync(process.execPath, [join(import.meta.dirname, '.e2e-vite-build.mjs'), join(import.meta.dirname, 'vite.app.config.ts')],",
        );
      } else {
        isolated = original.replace(
          "    'pnpm',\n    [\n      'exec',\n      'vp',\n      'build',\n      '--config',",
          "    process.execPath,\n    [\n      resolve(import.meta.dirname, '.e2e-vite-build.mjs'),",
        );
      }

      assert.notEqual(
        isolated,
        original,
        'Native build invocation changed; reassess Vite+ API bridge',
      );
      writeFileSync(file, isolated);
      writeFileSync(
        join(target, '.e2e-native-build.json'),
        JSON.stringify(
          {
            originalSha256: createHash('sha256').update(original).digest('hex'),
            stagedSha256: createHash('sha256').update(isolated).digest('hex'),
            invocation: 'same native config/cwd/env through Vite+1.5.0 (Vite8.3.5) build API',
            checks: 'original output scans and native type checks retained',
          },
          null,
          2,
        ) + '\n',
      );
    }

    const npm = join(repository, 'node_modules/npm/bin/npm-cli.js');
    const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
    execFileSync(
      process.execPath,
      [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--before=' + cutoff],
      { cwd: target, stdio: 'pipe', timeout: 180_000 },
    );
    assertReleaseResolution(target, artifacts);
    if (name === 'sveltekit') {
      const compiler = execFileSync(
        process.execPath,
        [join(target, 'node_modules/typescript-native/bin/tsc'), '--version'],
        { encoding: 'utf8', timeout: 10_000 },
      ).trim();
      assert.equal(
        compiler,
        'Version ' + workspace.catalog.typescript,
        'Native app checks must use exact TS7',
      );
      writeFileSync(
        join(target, '.e2e-native-compiler.json'),
        JSON.stringify(
          {
            compiler,
            apiPeer: JSON.parse(
              readFileSync(join(target, 'node_modules/typescript/package.json'), 'utf8'),
            ).version,
            command: [process.execPath, 'node_modules/typescript-native/bin/tsc'],
          },
          null,
          2,
        ) + '\n',
      );
    }

    if (name === 'solidstart') {
      applySolidStartSdkPatch(target);
    }

    if (name === 'react-router') {
      applyRouterLoggingPatch(target);
    }

    if (name === 'netlify') {
      prepareNetlifyTools(target, npm, security, cutoff);
      applyNetlifyLoggingPatch(target);
    }

    const installedLock = readFileSync(join(target, 'package-lock.json'));
    // Registration occurs only after this fully attested graph completes its ordinary native build.
    const nativeRoot = nativeOutputPath(name);
    assert.ok(
      !nativeRoot || !existsSync(join(target, nativeRoot)),
      'Native output existed before build',
    );

    if (scripts['build:app']) {
      execFileSync(process.execPath, [npm, 'run', 'build:app'], {
        cwd: target,
        stdio: 'pipe',
        timeout: 180_000,
      });
    }

    assert.deepEqual(
      readFileSync(join(target, 'package-lock.json')),
      installedLock,
      'Native build changed the npm-owned graph',
    );
    const candidates = physicalPackages(target).packages.filter((path) =>
      /(?:^|\/)node_modules\/@serverless-jwt\/[^/]+$/u.test(path),
    );
    const native = attestNativeOutput(target, name, key, artifacts, candidates);
    const aliases = assertReleaseResolution(target, artifacts, native);
    writeFileSync(
      join(target, '.e2e-artifacts.json'),
      JSON.stringify({ key, artifacts, aliases, native }, null, 2) + '\n',
    );
    return target;
  } catch (cause) {
    const logs = privateLogs([]);
    const failure = cause as { readonly stdout?: Buffer; readonly stderr?: Buffer };
    if (failure.stdout) {
      logs.capture(failure.stdout);
    }

    if (failure.stderr) {
      logs.capture(failure.stderr);
    }

    try {
      logs.finish('reports/e2e/release-' + name + '-stage.log');
    } finally {
      rmSync(target, { recursive: true, force: true });
    }

    throw new Error('Isolated release application install or build failed: ' + name);
  }
}

/**
 * Prepared consumers revalidate the native provenance recorded only after a successful build. A raw
 * assertion deliberately grants no independent-copy permission.
 */
export function assertPreparedReleaseResolution(
  app: string,
  artifacts: ReadonlyArray<Artifact>,
): ReadonlyArray<ReleaseAlias> {
  const file = join(app, '.e2e-artifacts.json');
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
  if (saved?.native) {
    assert.equal(saved.native.key, saved.key, 'Native output build identity differs');
  }

  if (existsSync(join(app, 'node_modules/@solidjs/start/package.json'))) {
    assertSolidStartSdkPatch(app);
  }

  return assertReleaseResolution(app, artifacts, saved?.native);
}

/**
 * Finds a release-staged app only when explicitly prepared; source is used in ordinary PR mode.
 */
export function applicationDirectory(name: string): string {
  const mapping = process.env.E2E_APPLICATIONS;
  if (!mapping && !process.env.E2E_FROM_TARBALLS && !process.env.E2E_FROM_REGISTRY) {
    return join(repository, 'e2e/apps', name);
  }

  assert.ok(mapping, 'Release mode requires prepared isolated applications');
  const applications = JSON.parse(readFileSync(mapping, 'utf8')) as Record<string, string>;
  const app = applications[name];
  assert.ok(
    app && !realpathSync(app).startsWith(realpathSync(repository) + sep),
    'Release app must live outside workspace',
  );
  if (process.env.E2E_FROM_TARBALLS) {
    assertPreparedReleaseResolution(app, tarballInventory(process.env.E2E_FROM_TARBALLS));
  } else {
    assertIsolatedInternals(app);
  }

  if (name === 'solidstart') {
    assertSolidStartSdkPatch(app);
  }

  return app;
}

/**
 * Allocates a private parent for a complete release-mode run, disposed by its caller.
 */
export function releaseDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'serverless-jwt-e2e-release-'));
}

/**
 * Snapshots app files and immutable outputs for a single run, keeping dev tools away from siblings.
 */
export function snapshotApplication(source: string, configuration: string): string {
  const isolated = Boolean(
    process.env.E2E_APPLICATIONS || process.env.E2E_FROM_TARBALLS || process.env.E2E_FROM_REGISTRY,
  );
  const releaseArtifacts = process.env.E2E_FROM_TARBALLS
    ? tarballInventory(process.env.E2E_FROM_TARBALLS)
    : undefined;
  const native =
    releaseArtifacts && existsSync(join(source, '.e2e-artifacts.json'))
      ? (JSON.parse(readFileSync(join(source, '.e2e-artifacts.json'), 'utf8')).native as
          | NativeOutput
          | undefined)
      : undefined;
  const aliases = releaseArtifacts ? assertPreparedReleaseResolution(source, releaseArtifacts) : [];
  const target = join(configuration, 'application');
  assert.ok(
    resolve(source) !== resolve(target) && !resolve(source).startsWith(resolve(target) + sep),
    'Snapshot must not replace source',
  );
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(source, target, {
    recursive: true,
    filter: (path) => !['node_modules', '.wrangler', '.netlify', '.cache'].includes(basename(path)),
  });
  if (isolated) {
    const lockPath = join(target, 'package-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
      readonly packages: Record<string, { resolved?: string }>;
    };
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (
        /(?:^|\/)node_modules\/@serverless-jwt\//.test(path) &&
        entry.resolved?.startsWith('file:')
      ) {
        entry.resolved = 'file:' + realpathSync(resolve(source, entry.resolved.slice(5)));
      }
    }

    writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
    cpSync(join(source, 'node_modules'), join(target, 'node_modules'), {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
    });
    if (native) {
      // Native traced dependencies are part of the attested immutable output, not workspace tools.
      rmSync(join(target, native.output), { recursive: true, force: true });
      cpSync(join(source, native.output), join(target, native.output), {
        recursive: true,
        verbatimSymlinks: true,
        mode: constants.COPYFILE_FICLONE,
      });
    }

    // Recreate accepted native aliases against this snapshot's own canonical installed package bytes.
    for (const alias of aliases) {
      const location = resolve(target, alias.alias);
      const installed = resolve(target, relative(realpathSync(source), alias.installed));
      assert.ok(
        location.startsWith(resolve(target) + sep) && installed.startsWith(resolve(target) + sep),
        'Snapshot alias escaped isolated app',
      );
      mkdirSync(dirname(location), { recursive: true });
      symlinkSync(relative(dirname(location), installed), location, 'dir');
    }

    if (process.env.E2E_FROM_TARBALLS) {
      assertPreparedReleaseResolution(target, tarballInventory(process.env.E2E_FROM_TARBALLS));
    } else {
      assertIsolatedInternals(target);
    }
  } else {
    symlinkSync(join(source, 'node_modules'), join(target, 'node_modules'), 'dir');
  }

  cpSync(join(repository, 'tsconfig.base.json'), join(target, 'tsconfig.e2e-base.json'));
  if (existsSync(join(target, 'tsconfig.json'))) {
    const config = JSON.parse(readFileSync(join(target, 'tsconfig.json'), 'utf8'));
    config.extends = './tsconfig.e2e-base.json';
    writeFileSync(join(target, 'tsconfig.json'), JSON.stringify(config, null, 2) + '\n');
  }

  return target;
}

/**
 * Requires outside-workspace registry consumers to own every resolved internal package and lock
 * integrity.
 */
export function assertIsolatedInternals(app: string): void {
  const root = realpathSync(app);
  assert.ok(!root.startsWith(realpathSync(repository) + sep), 'External app entered workspace');
  const lock = JSON.parse(readFileSync(join(app, 'package-lock.json'), 'utf8')) as {
    readonly packages: Readonly<
      Record<
        string,
        { readonly version?: string; readonly integrity?: string; readonly link?: boolean }
      >
    >;
  };
  const entries = Object.entries(lock.packages).filter(([path]) =>
    /(?:^|\/)node_modules\/@serverless-jwt\//.test(path),
  );
  assert.ok(entries.length > 0, 'External app has no locked internal packages');
  for (const [path, entry] of entries) {
    const installed = realpathSync(join(app, path));
    assert.ok(installed.startsWith(root + sep), 'External internal package escaped app');
    assert.equal(entry.link, undefined, 'External app resolved a workspace link');
    assert.match(entry.integrity ?? '', /^sha512-[A-Za-z0-9+/]+={0,2}$/);
    assert.equal(
      JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')).version,
      entry.version,
    );
  }
}
