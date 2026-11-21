import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempDisposableSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { verifyAstroConsumer } from './package-astro.mjs';
import { assertJavaScriptImports } from './package-imports.mjs';
import { verifyNuxtV2Consumer, verifyEntryIsolation } from './package-node-entries.mjs';
import { verifyPnpmConsumer } from './package-pnpm.mjs';
import { verifySvelteKitConsumer } from './package-sveltekit.mjs';
import { validatePackage } from './package-validation.ts';

/**
 * Resolves the source checkout for manifest and fixture comparisons.
 */
const root = resolve(import.meta.dirname, '..');
/**
 * Selects the directory containing exact tarballs to validate.
 */
const tarballDirectory = resolve(process.argv[2] ?? join(root, 'artifacts'));
/**
 * Bounds cold consumer installs and package validation commands.
 */
const timeout = 180_000;
/**
 * Runs a consumer probe with visible diagnostics and a bounded deadline.
 */
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit', timeout });
/**
 * Uses the catalog-pinned npm implementation for consumer installs.
 */
const npm = join(root, 'node_modules/npm/bin/npm-cli.js');
assert.equal(
  JSON.parse(readFileSync(join(root, 'node_modules/npm/package.json'))).version,
  '12.2.1',
);
/**
 * Applies the same seven-day release-age policy as the workspace.
 */
const before = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
/**
 * Finds package artifacts without rebuilding or altering them.
 */
const tarballs = readdirSync(tarballDirectory)
  .filter((name) => name.endsWith('.tgz'))
  .map((name) => join(tarballDirectory, name));
assert.ok(tarballs.length > 0, 'Pack packages into the supplied directory first.');
/**
 * Reads artifact manifests before resolving internal dependency tarballs.
 */
const inventory = tarballs.map((tarball) => ({ tarball, ...validatePackage(tarball) }));
/**
 * Requires an explicit minimum-supported runtime for CommonJS probes.
 */
const minimumNode = process.env.MIN_NODE_BIN;
assert.ok(minimumNode, 'Set MIN_NODE_BIN to an explicit Node 24.0.0 binary.');
assert.equal(execFileSync(minimumNode, ['--version'], { encoding: 'utf8' }).trim(), 'v24.0.0');

for (const { tarball, manifest, names, declarationCompanions } of inventory) {
  using temporary = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-consumer-'));
  const consumer = temporary.path;
  const source = join(root, manifest.repository.directory);
  const sourceManifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  assert.equal(manifest.version, sourceManifest.version);
  assert.equal(manifest.sideEffects, false);
  assert.equal(manifest.engines.node, '>=24.0.0');
  for (const section of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
    'devDependencies',
  ]) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (sourceManifest[section]?.[name] === 'workspace:*') {
        assert.equal(
          version,
          inventory.find((entry) => entry.manifest.name === name)?.manifest.version,
        );
      }
    }
  }

  if (manifest.name === '@serverless-jwt/astro') {
    assert.equal(
      execFileSync('tar', ['-xOf', tarball, 'package/dist/type-repair/manifest.json'], {
        encoding: 'utf8',
      }),
      readFileSync(join(source, 'type-repair/manifest.json'), 'utf8'),
      'Astro repair manifest differs from reviewed source',
    );
  }

  for (const companion of declarationCompanions) {
    assert.ok(names.includes(companion), 'Reviewed declaration companion is missing');
    assert.equal(
      execFileSync('tar', ['-xOf', tarball, companion], { encoding: 'utf8' }),
      readFileSync(
        manifest.name === '@serverless-jwt/astro'
          ? join(source, 'type-repair', companion.slice('package/dist/type-repair/'.length))
          : join(source, 'src', companion.split('/').at(-1)),
        'utf8',
      ),
      'Declaration companion differs from its reviewed source',
    );
  }

  for (const name of names) {
    assert.match(name, /^package\/(dist\/|README\.md$|LICENSE$|package\.json$)/);
    assert.ok(!name.endsWith('.cjs'), `CommonJS runtime artifact shipped: ${name}`);
    if (/\.[cm]?js$/.test(name)) {
      const code = execFileSync('tar', ['-xOf', tarball, name], { encoding: 'utf8' });
      assertJavaScriptImports(code, name);
    }
  }

  verifyEntryIsolation(tarball, manifest, names);

  const internal = new Map();
  const collect = (item) => {
    for (const name of Object.keys(item.manifest.dependencies ?? {})) {
      const dependency = inventory.find((entry) => entry.manifest.name === name);
      if (dependency && !internal.has(name)) {
        internal.set(name, dependency.tarball);
        collect(dependency);
      }
    }
  };
  collect({ manifest });
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: {
        [manifest.name]: `file:${tarball}`,
        ...Object.fromEntries([...internal].map(([name, path]) => [name, `file:${path}`])),
        ...Object.fromEntries(
          Object.entries(manifest.peerDependencies ?? {}).filter(
            ([name]) =>
              !internal.has(name) &&
              !(manifest.name === '@serverless-jwt/nuxt' && name === 'crossws'),
          ),
        ),
        ...(manifest.name === '@serverless-jwt/nuxt' ? { h3: '1.15.11' } : {}),
      },
      overrides: {
        ...Object.fromEntries([...internal].map(([name]) => [name, '$' + name])),
        // Kit's actual build tooling needs the same reviewed fix in isolated npm consumers.
        ...(manifest.name === '@serverless-jwt/sveltekit'
          ? {
              '@sveltejs/vite-plugin-svelte@7.3.1': { deepmerge: 'npm:@stackline/deepmerge@1.1.0' },
            }
          : {}),
      },
    }),
  );
  run(
    process.execPath,
    [npm, 'install', '--no-audit', '--no-fund', '--ignore-scripts', `--before=${before}`],
    consumer,
  );
  if (manifest.name === '@serverless-jwt/jwt-verifier') {
    assert.ok(names.includes('package/dist/adapter.mjs'));
    assert.ok(names.includes('package/dist/adapter.d.mts'));
    assert.ok(!JSON.stringify(manifest.exports).includes('source'));
    writeFileSync(
      join(consumer, 'identity.mjs'),
      `
      import assert from 'node:assert/strict';
      import { JwtVerifierError, ConfigurationError, createJwtVerifier } from '@serverless-jwt/jwt-verifier';
      import { createGuard, authorizationFromLambdaEvent } from '@serverless-jwt/jwt-verifier/adapter';
      const guard = createGuard({ verifier: createJwtVerifier({ issuer: 'https://issuer.test', audience: 'api' }) });
      const result = await guard.decide({ method: 'GET', url: 'https://api.test', authorization: [], header: () => undefined });
      assert.equal(result.kind, 'reject');
      assert.ok(result.error instanceof JwtVerifierError);
      assert.equal(result.error.reason, 'missing_token');
      assert.equal(result.http.status, 401);
      assert.throws(() => authorizationFromLambdaEvent({}, 'albMultiValue'), JwtVerifierError);
      assert.throws(() => createGuard({ verifier: guard.verifier, issuer: 'https://other.test' }), ConfigurationError);
    `,
    );
    run(process.execPath, ['identity.mjs'], consumer);
    run(minimumNode, ['identity.mjs'], consumer);
    cpSync(join(source, 'fixtures/core-copies.mjs'), join(consumer, 'core-copies.mjs'));
    run(process.execPath, ['core-copies.mjs'], consumer);
    run(minimumNode, ['core-copies.mjs'], consumer);
  }

  if (manifest.name === '@serverless-jwt/astro') {
    await verifyAstroConsumer(root, consumer, minimumNode, npm, before);
  }

  if (manifest.name === '@serverless-jwt/sveltekit') {
    await verifySvelteKitConsumer(root, consumer, minimumNode, npm, before);
  }

  const entries = Object.keys(manifest.exports);
  const specifiers = entries.map((entry) => manifest.name + (entry === '.' ? '' : entry.slice(1)));
  const probe = specifiers
    .map((specifier) =>
      specifier.endsWith('/package.json')
        ? `await import(${JSON.stringify(specifier)}, {with:{type:'json'}});`
        : `await import(${JSON.stringify(specifier)});`,
    )
    .join('\n');
  writeFileSync(join(consumer, 'probe.mjs'), probe);
  run(process.execPath, ['probe.mjs'], consumer);
  writeFileSync(
    join(consumer, 'probe.cjs'),
    specifiers.map((specifier) => `require(${JSON.stringify(specifier)});`).join('\n'),
  );
  run(minimumNode, ['probe.cjs'], consumer);
  assert.ok(
    existsSync(join(source, 'fixtures/consumer.ts')),
    'Each package needs a consumer fixture.',
  );
  cpSync(join(source, 'fixtures/consumer.ts'), join(consumer, 'consumer.ts'));
  if (manifest.name === '@serverless-jwt/netlify') {
    const deno = process.env.DENO_BIN;
    assert.ok(deno, 'Set DENO_BIN to the verified Deno executable for packed Edge checks.');
    cpSync(join(source, 'fixtures/deno.ts'), join(consumer, 'deno.ts'));
    cpSync(join(source, 'fixtures/edge-consumer.ts'), join(consumer, 'edge-consumer.ts'));
    run(deno, ['check', '--node-modules-dir=manual', 'deno.ts'], consumer);
    const graph = JSON.parse(
      execFileSync(
        deno,
        [
          'info',
          '--json',
          '--node-modules-dir=manual',
          'node_modules/@serverless-jwt/netlify/dist/edge.mjs',
        ],
        { cwd: consumer, timeout, encoding: 'utf8' },
      ),
    );
    assert.ok(!graph.error);
    assert.ok(graph.modules.length > 0);
    for (const module of graph.modules) {
      assert.ok(!module.error, 'Packed Edge graph contains an unresolved module');
      assert.ok(!module.specifier.startsWith('node:'), 'Packed Edge runtime imports a Node module');
    }

    console.log('Verified packed Netlify Edge types and runtime graph with Deno.');
  }

  const extraFixtures =
    manifest.name === '@serverless-jwt/next'
      ? ['pages-consumer.ts']
      : manifest.name === '@serverless-jwt/netlify'
        ? ['v1-consumer.ts']
        : [];
  for (const fixture of extraFixtures) {
    cpSync(join(source, 'fixtures', fixture), join(consumer, fixture));
  }

  for (const mode of ['nodenext', 'bundler']) {
    for (const fixture of [
      ...(manifest.name === '@serverless-jwt/netlify'
        ? ['consumer.ts', 'edge-consumer.ts']
        : ['consumer.ts']),
      ...extraFixtures,
    ]) {
      writeFileSync(
        join(consumer, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            skipLibCheck: false,
            target: 'ES2023',
            lib:
              manifest.name === '@serverless-jwt/nuxt'
                ? ['ES2023', 'WebWorker', 'WebWorker.Iterable']
                : ['ES2023', 'DOM', 'DOM.Iterable'],
            types: [],
            module: mode === 'nodenext' ? 'nodenext' : 'esnext',
            moduleResolution: mode,
          },
          files: [fixture],
        }),
      );
      run(join(root, 'node_modules/.bin/tsc'), ['-p', join(consumer, 'tsconfig.json')], consumer);
    }
  }

  run(
    process.execPath,
    [join(root, 'node_modules/publint/src/cli.js'), '--strict', tarball],
    consumer,
  );
  run(join(root, 'node_modules/.bin/attw'), ['--pack', tarball, '--profile', 'esm-only'], consumer);
  if (manifest.name === '@serverless-jwt/next') {
    verifyPnpmConsumer(root, tarball, manifest, internal, source);
  }

  if (manifest.name === '@serverless-jwt/nuxt') {
    verifyNuxtV2Consumer(root, tarball, manifest, internal, source, npm, before);
  }

  console.log(`Verified ${manifest.name}@${manifest.version}.`);
}
