import type * as FsModule from 'node:fs';
import type * as ModuleModule from 'node:module';
import type * as UrlModule from 'node:url';

import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, expect, it, vi } from 'vite-plus/test';

const controls = vi.hoisted(() => ({ modulePath: '', failRename: false }));

vi.mock('node:url', async (importOriginal) => {
  const original = await importOriginal<typeof UrlModule>();
  return {
    ...original,
    fileURLToPath: (value: string | URL): string =>
      String(value).includes('/src/type-repair.ts') &&
      new Error().stack?.includes('repairAstroTypes')
        ? controls.modulePath
        : original.fileURLToPath(value),
  };
});

vi.mock('node:module', async (importOriginal) => {
  const original = await importOriginal<typeof ModuleModule>();
  return {
    createRequire: (value: string | URL): NodeJS.Require =>
      original.createRequire(
        String(value).includes('/src/type-repair.ts') ? controls.modulePath : value,
      ),
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof FsModule>();
  return {
    ...original,
    renameSync: (...args: Parameters<typeof original.renameSync>): void => {
      if (controls.failRename) {
        controls.failRename = false;
        throw new Error('Injected atomic rename failure');
      }

      original.renameSync(...args);
    },
  };
});

import { repairAstroTypes } from './type-repair.ts';

/**
 * Keeps every filesystem mutation inside disposable synthetic installations.
 */
const temporaryRoots: string[] = [];

/**
 * Describes the real filesystem owners used by transport and containment tests.
 */
interface Fixture {
  readonly base: string;
  readonly root: string;
  readonly adapter: string;
  readonly sdk: string;
  readonly storage: string;
  readonly markdown: string;
  readonly distribution: string;
  readonly generated: string;
  readonly originalSdk: string;
  readonly originalMarkdown: string;
}

/**
 * Hashes actual fixture bytes with the same public digest algorithm as the contract.
 */
function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Writes a fixture while creating only its disposable parent directories.
 */
function put(path: string, value: string | object): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
}

/**
 * Builds resolvable package metadata without importing or replacing any real SDK.
 */
function dependency(root: string, name: string, version: string, entry = 'index.js'): string {
  const directory = join(root, 'node_modules', name);
  put(join(directory, 'package.json'), { name, version, main: entry });
  put(join(directory, entry), 'export {};\n');
  return directory;
}

/**
 * Inventories all fixture-owned bytes before any repair runs.
 */
function inventory(root: string): { path: string; sha256: string }[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const absolute = join(entry.parentPath, entry.name);
      return {
        path: relative(root, absolute).replaceAll('\\', '/'),
        sha256: hash(readFileSync(absolute)),
      };
    });
}

/**
 * Produces a tiny complete three-owner contract with genuine Node package resolution.
 */
function fixture(built = false): Fixture {
  const base = mkdtempSync(join(tmpdir(), 'astro-type-repair-unit-'));
  temporaryRoots.push(base);
  const root = join(base, 'app');
  put(join(root, 'package.json'), { name: 'consumer', private: true });
  const adapter = dependency(root, '@serverless-jwt/astro', '0.0.0');
  const sdk = dependency(root, 'astro', '7.4.5');
  const storage = dependency(root, 'unstorage', '1.17.6', 'dist/nested/index.js');
  // A hidden package.json subpath exercises the documented main-entry fallback.
  put(join(storage, 'package.json'), {
    name: 'unstorage',
    version: '1.17.6',
    exports: { '.': './dist/nested/index.js' },
  });
  put(join(storage, 'dist/nested/package.json'), { name: 'an-internal-module' });
  const markdown = dependency(root, '@astrojs/markdown-remark', '7.3.5');
  const mongo = dependency(root, 'mongodb', '7.8.0');
  put(join(mongo, 'mongodb.d.ts'), 'export interface MongoClientOptions {}\n');
  const redis = dependency(root, 'ioredis', '5.11.1');
  put(join(redis, 'built/index.d.ts'), 'export interface RedisOptions {}\n');
  for (const [name, version] of [
    ['unist', '3.0.3'],
    ['hast', '3.0.5'],
    ['mdast', '4.0.4'],
  ]) {
    const directory = dependency(root, `@types/${name}`, version ?? '');
    put(join(directory, 'index.d.ts'), 'export interface Node {}\n');
  }

  const originalSdk = 'export interface OriginalSdk {}\n';
  const originalMarkdown = 'export interface OriginalMarkdown {}\n';
  put(join(sdk, 'dist/types.d.ts'), originalSdk);
  put(join(sdk, 'dist/other.d.ts'), 'export interface Other {}\n');
  put(join(markdown, 'dist/types.d.ts'), originalMarkdown);
  const distribution = join(adapter, built ? 'dist/type-repair' : 'type-repair');
  const vendor = 'export interface SourceExactFixture {}\n';
  const generated =
    "import type { MongoClientOptions } from '__SERVERLESS_JWT_MONGODB__';\nimport type { RedisOptions } from '__SERVERLESS_JWT_IOREDIS__';\n";
  const payload =
    "export type Source = import('__SERVERLESS_JWT_VENDOR__/core.js').SourceExactFixture;\nexport type Options = import('__SERVERLESS_JWT_OPTIONS__');\n";
  const markdownPayload =
    "export type U = import('__SERVERLESS_JWT_UNIST__');\nexport type H = import('__SERVERLESS_JWT_HAST__');\nexport type M = import('__SERVERLESS_JWT_MDAST__');\n";
  put(join(distribution, 'vendor/core.d.ts'), vendor);
  put(join(distribution, 'vendor/options.d.mts'), generated);
  put(join(distribution, 'payloads/sdk.d.ts'), payload);
  put(join(distribution, 'payloads/other.d.ts'), 'export interface RepairedOther {}\n');
  put(join(distribution, 'payloads/markdown.d.ts'), markdownPayload);
  put(join(distribution, 'manifest.json'), {
    astroVersion: '7.4.5',
    sdkFiles: inventory(sdk),
    assets: [{ path: 'vendor/core.d.ts', sha256: hash(vendor) }],
    repairs: [
      { path: 'dist/types.d.ts', source: 'payloads/sdk.d.ts', sha256: hash(payload) },
      {
        path: 'dist/other.d.ts',
        source: 'payloads/other.d.ts',
        sha256: hash('export interface RepairedOther {}\n'),
      },
    ],
    unstorage: { version: '1.17.6', files: inventory(storage) },
    generated: [
      { path: 'dist/options.d.mts', source: 'vendor/options.d.mts', sha256: hash(generated) },
    ],
    markdown: {
      version: '7.3.5',
      files: inventory(markdown),
      repairs: [
        {
          path: 'dist/types.d.ts',
          source: 'payloads/markdown.d.ts',
          sha256: hash(markdownPayload),
        },
      ],
    },
  });
  controls.modulePath = join(adapter, built ? 'dist/type-repair.mjs' : 'src/type-repair.ts');
  return {
    base,
    root,
    adapter,
    sdk,
    storage,
    markdown,
    distribution,
    generated: join(storage, 'dist/options.d.mts'),
    originalSdk,
    originalMarkdown,
  };
}

/**
 * Applies controlled malformed JSON mutations to the public shipped contract.
 */
function manifest(f: Fixture, mutate: (value: Record<string, unknown>) => void): void {
  const path = join(f.distribution, 'manifest.json');
  const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  mutate(value);
  put(path, value);
}

/**
 * Changes package metadata only in synthetic fixtures.
 */
function metadata(directory: string, mutate: (value: Record<string, unknown>) => void): void {
  const path = join(directory, 'package.json');
  const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  mutate(value);
  put(path, value);
}

/**
 * Moves one synthetic owner outside its installation while retaining a resolution link.
 */
function externalize(f: Fixture, owner: string): string {
  const outside = join(f.base, 'outside', relative(f.root, owner).replaceAll('/', '-'));
  mkdirSync(dirname(outside), { recursive: true });
  renameSync(owner, outside);
  symlinkSync(outside, owner, 'dir');
  return outside;
}

/**
 * Verifies failures occur before any installed declaration is changed.
 */
function unchanged(f: Fixture): void {
  expect(readFileSync(join(f.sdk, 'dist/types.d.ts'), 'utf8')).toBe(f.originalSdk);
  expect(readFileSync(join(f.markdown, 'dist/types.d.ts'), 'utf8')).toBe(f.originalMarkdown);
  expect(existsSync(f.generated)).toBe(false);
}

afterEach(() => {
  controls.failRename = false;
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

it.each([false, true])(
  'repairs source/built distribution=%s atomically and verifies idempotently',
  (built) => {
    const f = fixture(built);
    const sdkRuntime = readFileSync(join(f.sdk, 'index.js'));
    const immutableAssets = inventory(f.distribution);
    expect(() => repairAstroTypes({ root: f.root, check: true })).toThrow('has not been applied');
    unchanged(f);
    expect(repairAstroTypes({ root: f.root })).toEqual({ version: '7.4.5', changed: 4 });
    expect(repairAstroTypes({ root: f.root, check: true })).toEqual({
      version: '7.4.5',
      changed: 0,
    });
    expect(repairAstroTypes({ root: f.root })).toEqual({ version: '7.4.5', changed: 0 });
    expect(readFileSync(join(f.sdk, 'index.js'))).toEqual(sdkRuntime);
    expect(inventory(f.distribution)).toEqual(immutableAssets);
    expect(readFileSync(f.generated, 'utf8')).toContain('mongodb/mongodb.d.ts');
    expect(readFileSync(f.generated, 'utf8')).not.toContain('__SERVERLESS_JWT_');
    expect(readFileSync(join(f.markdown, 'dist/types.d.ts'), 'utf8')).toContain(
      '@types/hast/index.d.ts',
    );
    expect(readdirSync(join(f.sdk, 'dist'))).not.toContain(
      `types.d.ts.serverless-jwt-${process.pid}.tmp`,
    );
  },
);

it('uses the working directory by default and permits an explicitly bounded workspace app', () => {
  const f = fixture();
  vi.spyOn(process, 'cwd').mockReturnValue(f.root);
  expect(repairAstroTypes().changed).toBe(4);
  const app = join(f.root, 'apps/web');
  put(join(app, 'package.json'), { name: 'workspace-app' });
  expect(repairAstroTypes({ root: app, installationRoot: f.root, check: true }).changed).toBe(0);
});

it('repairs only remaining original bytes in a mixed installation', () => {
  const f = fixture();
  repairAstroTypes({ root: f.root });
  put(join(f.sdk, 'dist/types.d.ts'), f.originalSdk);
  expect(repairAstroTypes({ root: f.root }).changed).toBe(1);
});

it('cleans a created temporary file if atomic replacement fails', () => {
  const f = fixture();
  controls.failRename = true;
  expect(() => repairAstroTypes({ root: f.root })).toThrow('Injected atomic rename failure');
  unchanged(f);
  expect(readdirSync(join(f.storage, 'dist')).some((name) => name.endsWith('.tmp'))).toBe(false);
});

it('does not overwrite or remove an existing temporary-file collision', () => {
  const f = fixture();
  const temporary = `${f.generated}.serverless-jwt-${process.pid}.tmp`;
  put(temporary, 'owned by another invocation');
  expect(() => repairAstroTypes({ root: f.root })).toThrow(/EEXIST|file already exists/u);
  expect(readFileSync(temporary, 'utf8')).toBe('owned by another invocation');
  unchanged(f);
});

it.each([null, [], 'invalid'])('rejects a non-object manifest %j', (value) => {
  const f = fixture();
  put(join(f.distribution, 'manifest.json'), JSON.stringify(value));
  expect(() => repairAstroTypes({ root: f.root })).toThrow(
    'Invalid Astro declaration repair manifest',
  );
  unchanged(f);
});

it.each(['astroVersion', 'sdkFiles', 'assets', 'repairs', 'generated'])(
  'rejects an invalid top-level %s',
  (key) => {
    const f = fixture();
    manifest(f, (value) => {
      value[key] = 42;
    });
    expect(() => repairAstroTypes({ root: f.root })).toThrow(
      'Invalid Astro declaration repair manifest',
    );
    unchanged(f);
  },
);

it.each([
  ['unstorage', 'version'],
  ['unstorage', 'files'],
  ['markdown', 'version'],
  ['markdown', 'files'],
  ['markdown', 'repairs'],
])('rejects invalid %s.%s metadata', (owner, key) => {
  const f = fixture();
  manifest(f, (value) => {
    (value[owner ?? ''] as Record<string, unknown>)[key ?? ''] = 42;
  });
  expect(() => repairAstroTypes({ root: f.root })).toThrow('declaration repair inventory');
  unchanged(f);
});

it.each([
  { path: 42 },
  { path: 'bad\\name' },
  { path: '/absolute' },
  { path: '../escape' },
  { path: './current' },
  { path: 'double//slash' },
  { sha256: 42 },
  { sha256: 'invalid' },
])('rejects malformed or escaping inventory entries %j', (fields) => {
  const f = fixture();
  manifest(f, (value) => {
    value.assets = [{ path: 'vendor/core.d.ts', sha256: hash('anything'), ...fields }];
  });
  expect(() => repairAstroTypes({ root: f.root })).toThrow(
    'Invalid Astro declaration repair file inventory',
  );
  unchanged(f);
});

it.each([
  { source: 42 },
  { source: 'untrusted/source.d.ts' },
  { path: 'dist/index.js' },
  { source: 'payloads/../escape.d.ts' },
])('rejects invalid repair declarations %j', (fields) => {
  const f = fixture();
  manifest(f, (value) => {
    value.repairs = [
      { path: 'dist/types.d.ts', source: 'payloads/sdk.d.ts', sha256: hash('payload'), ...fields },
    ];
  });
  expect(() => repairAstroTypes({ root: f.root })).toThrow(
    /Repair target must|Invalid Astro declaration repair file inventory/u,
  );
  unchanged(f);
});

it.each(['sdkFiles', 'assets', 'repairs'])('rejects duplicate Astro %s', (key) => {
  const f = fixture();
  manifest(f, (value) => {
    const entries = value[key] as unknown[];
    entries.push(entries[0]);
  });
  expect(() => repairAstroTypes({ root: f.root })).toThrow(
    'Invalid or duplicate Astro declaration repair targets',
  );
  unchanged(f);
});

it('rejects an un-inventoried Astro repair', () => {
  const f = fixture();
  manifest(f, (value) => {
    value.sdkFiles = [];
  });
  expect(() => repairAstroTypes({ root: f.root })).toThrow(
    'Invalid or duplicate Astro declaration repair targets',
  );
  unchanged(f);
});

it.each(['files', 'repairs'])('rejects duplicate markdown %s', (key) => {
  const f = fixture();
  manifest(f, (value) => {
    const entries = (value.markdown as Record<string, unknown>)[key] as unknown[];
    entries.push(entries[0]);
  });
  expect(() => repairAstroTypes({ root: f.root })).toThrow(
    'Invalid markdown or generated declaration repair targets',
  );
  unchanged(f);
});

it.each([
  'missing-markdown-target',
  'duplicate-generated',
  'existing-generated-target',
  'no-companion',
  'two-companions',
])('rejects %s', (kind) => {
  const f = fixture();
  manifest(f, (value) => {
    const generated = value.generated as Record<string, unknown>[];
    if (kind === 'missing-markdown-target') {
      (value.markdown as Record<string, unknown>).files = [];
    } else if (kind === 'duplicate-generated') {
      generated.push(generated[0] ?? {});
    } else if (kind === 'existing-generated-target') {
      const first = generated[0];
      if (first !== undefined) {
        first.path = 'dist/nested/index.js.d.ts';
      }

      (value.unstorage as Record<string, unknown>).files = [
        { path: 'dist/nested/index.js.d.ts', sha256: hash('') },
      ];
    } else if (kind === 'no-companion') {
      value.generated = [];
    } else {
      generated.push({ ...generated[0], path: 'dist/second.d.mts' });
    }
  });
  expect(() => repairAstroTypes({ root: f.root })).toThrow(
    /Invalid markdown or generated|Expected one audited/u,
  );
  unchanged(f);
});

it.each([
  ['astro', 'Unsupported Astro version'],
  ['unstorage', 'Unsupported unstorage version'],
  ['@astrojs/markdown-remark', 'Unsupported application markdown'],
  ['@types/unist', 'Unsupported application AST'],
  ['mongodb', 'Unsupported nominal storage'],
  ['ioredis', 'Unsupported nominal storage'],
])('rejects unsupported %s versions without changing declarations', (name, message) => {
  const f = fixture();
  metadata(join(f.root, 'node_modules', name ?? ''), (value) => {
    value.version = '99.0.0';
  });
  expect(() => repairAstroTypes({ root: f.root })).toThrow(message);
  unchanged(f);
});

it('fails closed on malformed installed package metadata', () => {
  const f = fixture();
  put(join(f.sdk, 'package.json'), 'null');
  expect(() => repairAstroTypes({ root: f.root })).toThrow(/Invalid package config|Invalid Astro/u);
  unchanged(f);
});

it('does not accept a package with the wrong owner name when walking parent manifests', () => {
  const f = fixture();
  metadata(join(f.root, 'node_modules/mongodb'), (value) => {
    value.name = 'a-different-owner';
  });
  expect(() => repairAstroTypes({ root: f.root })).toThrow(
    'Cannot locate declaration repair dependency: mongodb',
  );
  unchanged(f);
});

it('rejects an application outside its explicitly selected installation', () => {
  const f = fixture();
  const installation = join(f.root, 'nested-installation');
  mkdirSync(installation);
  expect(() => repairAstroTypes({ root: f.root, installationRoot: installation })).toThrow(
    'Application is outside',
  );
  unchanged(f);
});

it('requires the invoked repair package to match the application dependency', () => {
  const f = fixture();
  const app = join(f.root, 'apps/web');
  put(join(app, 'package.json'), { name: 'nested-app' });
  dependency(app, '@serverless-jwt/astro', '0.0.0');
  expect(() => repairAstroTypes({ root: app, installationRoot: f.root })).toThrow(
    'Invoke the declaration repair',
  );
  unchanged(f);
});

it.each(['sdk', 'storage'])('rejects a linked %s before reading its external manifest', (key) => {
  const f = fixture();
  const outside = externalize(f, key === 'sdk' ? f.sdk : f.storage);
  metadata(outside, (manifest) => {
    manifest.version = '99.0.0';
  });
  expect(() => repairAstroTypes({ root: f.root })).toThrow(
    'outside the explicit installation node_modules',
  );
  unchanged(f);
});

it.each(['adapter', 'distribution'])(
  'rejects a linked immutable %s outside its installation',
  (key) => {
    const f = fixture();
    const outside = externalize(f, key === 'adapter' ? f.adapter : f.distribution);
    if (key === 'adapter') {
      controls.modulePath = join(outside, 'src/type-repair.ts');
    }

    expect(() => repairAstroTypes({ root: f.root })).toThrow('Repair package is outside');
    unchanged(f);
  },
);

it('allows a real source workspace package within the explicit installation', () => {
  const f = fixture();
  const workspace = join(f.root, 'packages/astro');
  mkdirSync(dirname(workspace), { recursive: true });
  renameSync(f.adapter, workspace);
  symlinkSync(workspace, f.adapter, 'dir');
  controls.modulePath = join(workspace, 'src/type-repair.ts');
  expect(repairAstroTypes({ root: f.root }).changed).toBe(4);
});

it.each(['@astrojs/markdown-remark', '@types/hast', 'mongodb'])(
  'rejects a different application instance of %s',
  (name) => {
    const f = fixture();
    const app = join(f.root, 'apps/web');
    put(join(app, 'package.json'), { name: 'nested-app' });
    const original = join(f.root, 'node_modules', name);
    const duplicate = join(app, 'node_modules', name);
    mkdirSync(dirname(duplicate), { recursive: true });
    cpSync(original, duplicate, { recursive: true });
    expect(() => repairAstroTypes({ root: app, installationRoot: f.root })).toThrow(
      /type-peer identity|Nominal storage peers/u,
    );
    unchanged(f);
  },
);

it.each(['@astrojs/markdown-remark', '@types/mdast', 'ioredis'])(
  'rejects external installed peer %s',
  (name) => {
    const f = fixture();
    externalize(f, join(f.root, 'node_modules', name));
    expect(() => repairAstroTypes({ root: f.root })).toThrow(
      /outside the installation|AST type-peer identity|Nominal storage peers/u,
    );
    unchanged(f);
  },
);

it.each([
  ['asset', 'Unexpected Astro declaration repair asset'],
  ['generated-payload', 'Unexpected Astro declaration repair payload'],
  ['sdk-payload', 'Unexpected Astro declaration repair payload'],
  ['markdown-payload', 'Unexpected Astro declaration repair payload'],
  ['runtime', 'Unexpected SDK bytes'],
  ['declaration', 'Unexpected SDK bytes'],
  ['storage-runtime', 'Unexpected SDK bytes'],
  ['markdown-runtime', 'Unexpected SDK bytes'],
])('preflights %s drift before every write', (kind, message) => {
  const f = fixture();
  const paths: Record<string, string> = {
    asset: join(f.distribution, 'vendor/core.d.ts'),
    'generated-payload': join(f.distribution, 'vendor/options.d.mts'),
    'sdk-payload': join(f.distribution, 'payloads/sdk.d.ts'),
    'markdown-payload': join(f.distribution, 'payloads/markdown.d.ts'),
    runtime: join(f.sdk, 'index.js'),
    declaration: join(f.sdk, 'dist/other.d.ts'),
    'storage-runtime': join(f.storage, 'dist/nested/index.js'),
    'markdown-runtime': join(f.markdown, 'index.js'),
  };
  put(paths[kind ?? ''] ?? '', 'unexpected bytes');
  expect(() => repairAstroTypes({ root: f.root })).toThrow(message);
  unchanged(f);
});

it('rejects unexpected previously generated companion bytes', () => {
  const f = fixture();
  put(f.generated, 'unexpected companion');
  expect(() => repairAstroTypes({ root: f.root })).toThrow(
    'Unexpected generated unstorage declaration',
  );
  expect(readFileSync(join(f.sdk, 'dist/types.d.ts'), 'utf8')).toBe(f.originalSdk);
  expect(readFileSync(f.generated, 'utf8')).toBe('unexpected companion');
});

it.each(['application', 'asset', 'sdk-file', 'peer-file', 'generated-file'])(
  'contains symlinked %s files in their owning package',
  (kind) => {
    const f = fixture();
    const outside = join(f.base, 'outside.d.ts');
    put(outside, 'external bytes');
    const paths: Record<string, string> = {
      application: join(f.root, 'package.json'),
      asset: join(f.distribution, 'vendor/core.d.ts'),
      'sdk-file': join(f.sdk, 'dist/other.d.ts'),
      'peer-file': join(f.root, 'node_modules/mongodb/mongodb.d.ts'),
      'generated-file': f.generated,
    };
    const path = paths[kind] ?? '';
    rmSync(path, { force: true });
    symlinkSync(outside, path);
    expect(() => repairAstroTypes({ root: f.root })).toThrow('file escapes its package');
    expect(readFileSync(join(f.sdk, 'dist/types.d.ts'), 'utf8')).toBe(f.originalSdk);
    expect(readFileSync(outside, 'utf8')).toBe('external bytes');
  },
);

it('contains a newly generated declaration in its real parent directory', () => {
  const f = fixture();
  const parent = join(f.storage, 'dist/generated');
  mkdirSync(parent);
  externalize(f, parent);
  manifest(f, (value) => {
    const entry = (value.generated as Record<string, unknown>[])[0];
    if (entry !== undefined) {
      entry.path = 'dist/generated/options.d.mts';
    }
  });
  expect(() => repairAstroTypes({ root: f.root })).toThrow('Generated declaration escapes');
  unchanged(f);
});

it('emits explicit relative prefixes for a same-directory descendant peer', () => {
  const f = fixture();
  const original = join(f.root, 'node_modules/mongodb');
  const nested = join(f.storage, 'dist/peers/mongodb');
  mkdirSync(dirname(nested), { recursive: true });
  renameSync(original, nested);
  symlinkSync(nested, original, 'dir');
  expect(repairAstroTypes({ root: f.root }).changed).toBe(4);
  expect(readFileSync(f.generated, 'utf8')).toContain("from './peers/mongodb/mongodb.d.ts'");
});

it('rejects a different markdown instance resolved by Astro itself', () => {
  const f = fixture();
  const duplicate = join(f.sdk, 'node_modules/@astrojs/markdown-remark');
  mkdirSync(dirname(duplicate), { recursive: true });
  cpSync(f.markdown, duplicate, { recursive: true });
  expect(() => repairAstroTypes({ root: f.root })).toThrow(
    'Unsupported application markdown type-peer identity',
  );
  unchanged(f);
});

it('replaces a declaration without mutating a hardlinked package-store copy', () => {
  const f = fixture();
  const shared = join(f.base, 'store-copy.d.ts');
  linkSync(join(f.sdk, 'dist/types.d.ts'), shared);
  expect(repairAstroTypes({ root: f.root }).changed).toBe(4);
  expect(readFileSync(shared, 'utf8')).toBe(f.originalSdk);
  expect(readFileSync(join(f.sdk, 'dist/types.d.ts'), 'utf8')).not.toBe(f.originalSdk);
});
