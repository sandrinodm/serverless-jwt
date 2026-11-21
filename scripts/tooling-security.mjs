import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempDisposableSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import YAML from 'yaml';

/**
 * Reviewed published executable hashes, independently pinned beside the lockfile integrity.
 */
const evidence = JSON.parse(
  readFileSync(new URL('./tooling-security-evidence.json', import.meta.url)),
);
/**
 * Installed workspace whose full lock graph and actual consumers are checked.
 */
const root = resolve(import.meta.dirname, '..');

/**
 * Exercises returned and nested prototypes, legitimate merge callbacks and the upstream callable
 * API.
 */
function securityCases(merge) {
  for (const target of [Object.create(null), JSON.parse('{"__proto__":{"admin":true}}'), {}]) {
    const result = merge(target, JSON.parse('{"__proto__":{"admin":true}}'));
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(result.admin, undefined);
  }

  for (const placeholder of [null, undefined, false, 1, 'x', {}]) {
    const result = merge(
      { session: placeholder },
      JSON.parse('{"session":{"__proto__":{"admin":true}}}'),
    );
    assert.equal(Object.getPrototypeOf(result.session), Object.prototype);
    assert.equal(result.session.admin, undefined);
  }

  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const input = JSON.parse('{"' + key + '":{"prototype":{"admin":true}}}');
    const result = merge.all([{}, input]);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(result.admin, undefined);
    assert.equal(Object.hasOwn(Object.prototype, 'admin'), false);
  }

  for (const value of [
    merge.all([{}, { entries: [JSON.parse('{"__proto__":{"admin":true}}')] }]),
    merge({}, { nested: [JSON.parse('{"__proto__":{"admin":true}}')] }),
  ]) {
    const nested = (value.entries ?? value.nested)[0];
    assert.equal(Object.getPrototypeOf(nested), Object.prototype);
    assert.equal(nested.admin, undefined);
  }

  let reads = 0;
  const poison = Object.defineProperty({}, '__proto__', {
    enumerable: true,
    get() {
      reads++;
      return { admin: true };
    },
  });
  merge(poison, {});
  merge(Object.create(null), poison);
  assert.equal(reads, 0);
  const symbol = Symbol('own');
  const merged = merge(
    { items: [1], nested: { a: 1 } },
    { items: [2], nested: { b: 2 }, [symbol]: 3 },
  );
  assert.deepEqual(merged.items, [1, 2]);
  assert.deepEqual(merged.nested, { a: 1, b: 2 });
  assert.equal(merged[symbol], 3);
  assert.deepEqual(merge({ items: [1] }, { items: [2] }, { arrayMerge: (_a, b) => b }), {
    items: [2],
  });
  assert.deepEqual(
    merge(
      { nested: { a: 1 } },
      { nested: { b: 2 } },
      {
        customMerge: (key) =>
          key === 'nested' ? (a, b) => ({ ...a, ...b, custom: true }) : undefined,
      },
    ),
    { nested: { a: 1, b: 2, custom: true } },
  );
  assert.deepEqual(merge.all([{ a: 1 }, { b: 2 }]), { a: 1, b: 2 });
}

/**
 * Resolves both actual import and require targets from a consumer and verifies their reviewed
 * bytes.
 */
export async function verifyDeepmergeConsumer(consumerDirectory) {
  const require = createRequire(join(consumerDirectory, 'package.json'));
  const manifestFile = require.resolve('deepmerge/package.json');
  const manifest = JSON.parse(readFileSync(manifestFile));
  assert.equal(manifest.name, evidence.package);
  assert.equal(manifest.version, evidence.version);
  const cjs = require.resolve('deepmerge');
  const esm = fileURLToPath(
    execFileSync(
      process.execPath,
      ['--input-type=module', '--eval', "process.stdout.write(import.meta.resolve('deepmerge'))"],
      { cwd: consumerDirectory, encoding: 'utf8', timeout: 10_000 },
    ),
  );
  const packageDirectory = dirname(manifestFile);
  assert.equal(manifest.exports['.'].import.default, './dist/index.js');
  const importEntry = join(packageDirectory, manifest.exports['.'].import.default);
  assert.equal(esm, importEntry);
  for (const [entry, expected] of [
    [cjs, evidence.entries['dist/index.cjs']],
    [importEntry, evidence.entries['dist/index.js']],
  ]) {
    assert.equal(createHash('sha256').update(readFileSync(entry)).digest('hex'), expected);
  }

  securityCases(require(cjs));
  securityCases((await import(pathToFileURL(importEntry).href)).default);
  return {
    consumerDirectory,
    name: manifest.name,
    version: manifest.version,
    cjs,
    esm: importEntry,
  };
}

/**
 * Finds exact actual pnpm consumer packages without assuming their peer suffix or store location.
 */
function installedPackages(directory, name) {
  const encoded = name.replace('/', '+') + '@';
  return readdirSync(join(directory, 'node_modules/.pnpm'))
    .filter((entry) => entry.startsWith(encoded))
    .map((entry) => join(directory, 'node_modules/.pnpm', entry, 'node_modules', name));
}

/**
 * Proves real Netlify plugin grouping, custom arrays and nested build configuration still work.
 */
async function netlifyCases(directory) {
  const { mergeConfigs } = await import(pathToFileURL(join(directory, 'lib/merge.js')).href);
  const configs = [
    {
      build: { command: 'old', environment: { A: '1' } },
      values: [1],
      plugins: [{ package: 'same', inputs: { a: 1, values: [1] } }, { package: 'first' }],
    },
    {
      build: { command: 'new', environment: { B: '2' } },
      values: [2],
      plugins: [{ package: 'same', inputs: { b: 2, values: [2] } }, { package: 'last' }],
    },
  ];
  assert.deepEqual(mergeConfigs(configs), {
    build: { command: 'new', environment: { A: '1', B: '2' } },
    values: [2],
    plugins: [
      { package: 'same', inputs: { a: 1, b: 2, values: [2] } },
      { package: 'first' },
      { package: 'last' },
    ],
  });
  assert.deepEqual(
    mergeConfigs([{ values: [1] }, { values: [2] }], { concatenateArrays: true }).values,
    [2, 1],
  );
  const result = mergeConfigs([
    {},
    JSON.parse('{"build":{"environment":{"__proto__":{"admin":true}}}}'),
  ]);
  assert.equal(Object.getPrototypeOf(result.build.environment), Object.prototype);
  assert.equal(result.build.environment.admin, undefined);
}

/**
 * Exercises the actual Svelte config loader and compiler/preprocessor merge, preserving function
 * identity.
 */
export async function verifySvelteConfiguration(directory) {
  const { preResolveOptions } = await import(
    pathToFileURL(join(directory, 'src/utils/options.js')).href
  );
  using temporary = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-svelte-merge-'));
  writeFileSync(
    join(temporary.path, 'svelte.config.mjs'),
    `export default {compilerOptions:{accessors:true,cssHash:()=> 'configured'},preprocess:[{name:'configured'}],extensions:['.svx']};`,
  );
  const preprocess = { name: 'inline', markup: ({ content }) => ({ code: content }) };
  const result = await preResolveOptions(
    { preprocess: [preprocess], compilerOptions: { dev: false } },
    { root: temporary.path },
    { command: 'build', mode: 'production' },
  );
  assert.deepEqual(result.extensions, ['.svx']);
  assert.equal(result.compilerOptions.accessors, true);
  assert.equal(result.compilerOptions.dev, false);
  assert.equal(result.compilerOptions.cssHash(), 'configured');
  assert.equal(result.preprocess.length, 1);
  assert.equal(result.preprocess[0].name, 'inline');
  assert.equal(result.preprocess[0].markup, preprocess.markup);
  assert.equal(result.isBuild, true);
}

/**
 * Rejects the Zod resource-amplification regression through each actual affected consumer
 * resolution.
 */
function zodCases(directory) {
  const require = createRequire(join(directory, 'package.json'));
  const { z } = require('zod');
  const manifest = require('zod/package.json');
  assert.equal(manifest.version, '4.6.7');
  let visits = 0;
  const result = z
    .array(
      z.preprocess((value) => {
        visits++;
        return value;
      }, z.string()),
    )
    .max(1)
    .safeParse(Array(100).fill(123));
  assert.equal(result.success, false);
  assert.equal(visits, 0);
  assert.equal(result.error.issues.length, 1);
}

/**
 * Rechecks the real Python-analysis CJS main against the pre-override positive and negative
 * vectors.
 */
function pythonSchemaCases(directory) {
  const require = createRequire(join(directory, 'package.json'));
  const analysis = require(directory);
  const cases = [
    [
      'PipfileLikeSchema',
      { packages: { requests: '*' }, scripts: { serve: 'python app.py' } },
      true,
    ],
    [
      'PipfileLikeSchema',
      { packages: { requests: { version: '>=2', extras: ['security'] } } },
      true,
    ],
    ['PipfileLikeSchema', { packages: { requests: 42 } }, false],
    [
      'PipfileLikeSchema',
      { source: [{ name: 'pypi', url: 'https://pypi.org/simple', verify_ssl: true }] },
      true,
    ],
    [
      'PipfileLockLikeSchema',
      {
        _meta: { requires: { python_version: '3.12' } },
        default: { requests: { version: '==2.32.0', hashes: ['sha256:fixture'] } },
      },
      true,
    ],
    ['PipfileLockLikeSchema', { default: { requests: { version: 42 } } }, false],
    [
      'PyProjectTomlSchema',
      {
        project: {
          name: 'fixture',
          version: '1.0.0',
          dependencies: ['fastapi>=0.1'],
          'optional-dependencies': { dev: ['pytest'] },
          scripts: { serve: 'fixture:main' },
        },
      },
      true,
    ],
    ['PyProjectTomlSchema', { project: { name: 42 } }, false],
    ['PyProjectTomlSchema', { project: { name: 'fixture', dependencies: [42] } }, false],
    [
      'PyProjectTomlSchema',
      { 'build-system': { requires: ['setuptools'], 'build-backend': 'setuptools.build_meta' } },
      true,
    ],
    [
      'UvConfigSchema',
      {
        workspace: { members: ['packages/*'], exclude: ['packages/private'] },
        index: [{ name: 'pypi', url: 'https://pypi.org/simple' }],
      },
      true,
    ],
    ['UvConfigSchema', { workspace: { members: [42] } }, false],
    ['PersonSchema', { name: 'Example', email: 'example@example.invalid' }, true],
    ['PersonSchema', { name: 42 }, false],
  ];
  for (const [schema, input, expected] of cases) {
    const result = analysis[schema].safeParse(input);
    assert.equal(result.success, expected, schema);
  }
}

/**
 * Checks the complete installed workspace graph and every exact affected framework consumer rather
 * than an unrelated copy.
 */
export async function verifyToolingSecurity(directory = root) {
  const lock = Object.assign(
    {},
    ...YAML.parseAllDocuments(readFileSync(join(directory, 'pnpm-lock.yaml'), 'utf8')).map(
      (document) => document.toJSON(),
    ),
  );
  assert.ok(!Object.keys(lock.packages).some((name) => name.startsWith('deepmerge@')));
  const affected = Object.entries(lock.snapshots).filter(
    ([, item]) => item.dependencies?.deepmerge,
  );
  assert.equal(affected.length, 3);
  for (const [name, item] of affected) {
    assert.match(
      name,
      /^(?:@netlify\/config@25\.6\.1|@sveltejs\/vite-plugin-svelte@7\.3\.1|@rollup\/plugin-node-resolve@16\.0\.3)(?:\(|$)/,
    );
    assert.equal(item.dependencies.deepmerge, '@stackline/deepmerge@1.1.0');
  }

  const resolutions = [];
  for (const consumer of installedPackages(directory, '@vercel/python-analysis')) {
    pythonSchemaCases(consumer);
  }

  for (const name of [
    '@netlify/config',
    '@sveltejs/vite-plugin-svelte',
    '@rollup/plugin-node-resolve',
  ]) {
    const packages = installedPackages(directory, name);
    assert.equal(packages.length, 1, 'Unexpected actual consumer count: ' + name);
    const consumer = packages[0];
    resolutions.push(await verifyDeepmergeConsumer(consumer));
    if (name === '@netlify/config') {
      await netlifyCases(consumer);
    } else if (name === '@sveltejs/vite-plugin-svelte') {
      await verifySvelteConfiguration(consumer);
    } else {
      await verifyRollupConfiguration(consumer);
    }
  }

  for (const name of [
    '@vercel/python-analysis',
    '@vercel/backends',
    '@vercel/hono',
    '@vercel/express',
    '@vercel/cli-config',
  ]) {
    const consumers = installedPackages(directory, name);
    assert.ok(consumers.length > 0, 'Missing affected Zod consumer: ' + name);
    for (const consumer of consumers) {
      zodCases(consumer);
    }
  }

  return resolutions;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(
    JSON.stringify(
      { result: 'passed', resolutions: await verifyToolingSecurity(process.argv[2] ?? root) },
      null,
      2,
    ),
  );
}

/**
 * Checks the isolated npm build-tooling graph without adding unrelated peers to the public
 * consumer.
 */
export async function verifyPackedSvelteTooling(consumer) {
  const require = createRequire(join(consumer, 'package.json'));
  const directory = dirname(dirname(require.resolve('@sveltejs/vite-plugin-svelte')));
  const plugin = JSON.parse(readFileSync(join(directory, 'package.json')));
  assert.equal(plugin.name, '@sveltejs/vite-plugin-svelte');
  assert.equal(plugin.version, '7.3.1');
  const lock = JSON.parse(readFileSync(join(consumer, 'package-lock.json')));
  const copies = Object.entries(lock.packages).filter(([name]) => name.endsWith('/deepmerge'));
  assert.ok(copies.length > 0, 'Packed Svelte consumer has no installed deepmerge');
  for (const [name, item] of copies) {
    assert.equal(item.name, evidence.package);
    assert.equal(item.version, evidence.version);
    assert.equal(item.integrity, evidence.integrity);
    const installed = JSON.parse(readFileSync(join(consumer, name, 'package.json')));
    assert.equal(installed.name, evidence.package);
    assert.equal(installed.version, evidence.version);
  }

  await verifyDeepmergeConsumer(directory);
  await verifySvelteConfiguration(directory);
}

/**
 * Reproduces the original returned-prototype defect and proves the current regression rejects it.
 */
export function verifyOriginalDeepmerge(directory) {
  const require = createRequire(join(directory, 'package.json'));
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json')));
  assert.equal(manifest.name, 'deepmerge');
  assert.equal(manifest.version, '4.3.1');
  const merge = require(directory);
  let reproduced = 0;
  for (const target of [Object.create(null), JSON.parse('{"__proto__":{"admin":true}}')]) {
    const result = merge(target, JSON.parse('{"__proto__":{"admin":true}}'));
    assert.notEqual(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(result.admin, true);
    reproduced++;
  }

  const nested = merge({ session: null }, JSON.parse('{"session":{"__proto__":{"admin":true}}}'));
  assert.notEqual(Object.getPrototypeOf(nested.session), Object.prototype);
  assert.equal(nested.session.admin, true);
  assert.equal(Object.hasOwn(Object.prototype, 'admin'), false);
  assert.throws(() => securityCases(merge), { code: 'ERR_ASSERTION' });
  return {
    original: manifest.version,
    reproduced: reproduced + 1,
    currentRegressionRejectsOriginal: true,
  };
}

/**
 * Exercises real CJS and ESM Rollup resolver plugins with browser and export-condition
 * configuration.
 */
export async function verifyRollupConfiguration(consumer) {
  const require = createRequire(join(consumer, 'package.json'));
  const manifest = JSON.parse(readFileSync(join(consumer, 'package.json')));
  assert.equal(manifest.name, '@rollup/plugin-node-resolve');
  assert.equal(manifest.version, '16.0.3');
  const cjs = require(consumer);
  const esm = await import(pathToFileURL(join(consumer, 'dist/es/index.js')).href);
  const { rollup } = await import(pathToFileURL(require.resolve('rollup')).href);
  using fixture = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-rollup-tooling-'));
  const dependency = join(fixture.path, 'node_modules/fixture-dependency');
  mkdirSync(dependency, { recursive: true });
  writeFileSync(
    join(dependency, 'package.json'),
    JSON.stringify({
      name: 'fixture-dependency',
      type: 'module',
      exports: {
        '.': { browser: './browser.js', development: './development.js', default: './default.js' },
      },
    }),
  );
  for (const name of ['browser', 'development', 'default']) {
    writeFileSync(
      join(dependency, name + '.js'),
      'export default ' + JSON.stringify(name + '-fixture') + ';',
    );
  }

  writeFileSync(
    join(fixture.path, 'entry.js'),
    "import value from 'fixture-dependency'; export default value;",
  );
  for (const implementation of [cjs, esm]) {
    assert.deepEqual(implementation.DEFAULTS.extensions, ['.mjs', '.js', '.json', '.node']);
    assert.ok(Object.isFrozen(implementation.DEFAULTS));
    assert.ok(Object.isFrozen(implementation.DEFAULTS.extensions));
    for (const [options, expected] of [
      [{ browser: true }, 'browser-fixture'],
      [{ browser: false, exportConditions: ['development'] }, 'development-fixture'],
      [{ browser: false, exportConditions: ['production'] }, 'default-fixture'],
    ]) {
      const bundle = await rollup({
        input: join(fixture.path, 'entry.js'),
        plugins: [implementation.nodeResolve(options)],
      });
      try {
        const output = await bundle.generate({ format: 'es' });
        assert.equal(output.output.length, 1);
        assert.deepEqual(output.output[0].imports, []);
        assert.ok(output.output[0].code.includes(expected));
      } finally {
        await bundle.close();
      }
    }
  }
}
