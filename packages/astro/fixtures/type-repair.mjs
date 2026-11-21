import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { repairAstroTypes as invokeRepair } from '@serverless-jwt/astro/type-repair';

/**
 * Uses the same explicit installation boundary documented for workspace applications.
 */
function repairAstroTypes(options = {}) {
  return invokeRepair({ ...(process.env.ASTRO_REPAIR_INSTALLATION_ROOT ? { installationRoot: process.env.ASTRO_REPAIR_INSTALLATION_ROOT } : {}), ...options });
}

const require = createRequire(import.meta.url);
const astro = dirname(require.resolve('astro/package.json'));
const adapter = dirname(require.resolve('@serverless-jwt/astro/package.json'));
const manifest = JSON.parse(readFileSync(join(adapter, 'dist/type-repair/manifest.json'), 'utf8'));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const original = new Map(manifest.sdkFiles.map((file) => [file.path, readFileSync(join(astro, file.path))]));
const adapterFiles = [{path:'manifest.json'},{path:'provenance.json'},...manifest.assets, ...[...manifest.repairs,...manifest.markdown.repairs].map((file) => ({ path: file.source }))];
const adapterHashes = new Map(adapterFiles.map((file) => [file.path, digest(readFileSync(join(adapter, 'dist/type-repair', file.path)))]));
const storageMain = createRequire(join(astro, 'package.json')).resolve('unstorage');
const storage = dirname(dirname(storageMain));
const generated = join(storage, manifest.generated[0].path);
const markdown = dirname(dirname(require.resolve('@astrojs/markdown-remark')));
const originalMarkdown = new Map(manifest.markdown.files.map((file) => [file.path, readFileSync(join(markdown, file.path))]));
const originalStorage = new Map(manifest.unstorage.files.map((file) => [file.path, readFileSync(join(storage, file.path))]));
const nested = mkdtempSync(join(process.cwd(), '.astro-type-repair-app-'));
writeFileSync(join(nested, 'package.json'), '{"private":true,"type":"module"}');

/**
 * Replaces a consumer test file without writing through pnpm hardlinks.
 */
function replace(path, content) {
  const temporary = `${path}.negative-control-${process.pid}`;
  writeFileSync(temporary, content, { flag: 'wx' });
  renameSync(temporary, path);
}

/**
 * Confirms rejected invocations have not applied any Astro declaration changes.
 */
function untouched() {
  for (const [owner, inventory] of [[astro, original], [markdown, originalMarkdown], [storage, originalStorage]]) {
    for (const [path, bytes] of inventory) {
      assert.deepEqual(readFileSync(join(owner, path)), bytes, path);
    }
  }
}

// Ordinary imports and check mode cannot repair the installation.
assert.throws(() => repairAstroTypes({ check: true }), /has not been applied/u);
untouched();
assert.equal(existsSync(generated), false);

// Real application and explicit installation boundaries prevent ancestor/global fallbacks.
assert.throws(() => repairAstroTypes({ root: join(process.cwd(), 'nonexistent-app') }));
assert.throws(() => invokeRepair({ root: nested }), /outside the explicit installation node_modules/u);
untouched();

// Unknown SDK versions and runtime drift fail before declaration writes.
const packagePath = join(astro, 'package.json');
const packageBytes = readFileSync(packagePath);
replace(packagePath, JSON.stringify({ ...JSON.parse(packageBytes), version: '0.0.0-invalid' }));
assert.throws(() => repairAstroTypes(), /Unsupported Astro version/u);
replace(packagePath, packageBytes);
const runtimePath = join(astro, 'dist/index.js');
const runtimeBytes = readFileSync(runtimePath);
replace(runtimePath, Buffer.concat([runtimeBytes, Buffer.from('\n// unexpected SDK drift\n')]));
assert.throws(() => repairAstroTypes(), /Unexpected SDK bytes/u);
replace(runtimePath, runtimeBytes);
untouched();
assert.equal(existsSync(generated), false);

// Unknown generated declarations and preexisting temporary files are never overwritten.
writeFileSync(generated, 'unexpected generated declaration', { flag: 'wx' });
assert.throws(() => repairAstroTypes(), /Unexpected generated unstorage declaration/u);
assert.equal(readFileSync(generated, 'utf8'), 'unexpected generated declaration');
unlinkSync(generated);
untouched();
const temporary = `${generated}.serverless-jwt-${process.pid}.tmp`;
writeFileSync(temporary, 'preexisting temporary file', { flag: 'wx' });
assert.throws(() => repairAstroTypes(), /EEXIST/u);
assert.equal(readFileSync(temporary, 'utf8'), 'preexisting temporary file');
unlinkSync(temporary);
untouched();

const repaired = repairAstroTypes();
assert.equal(repaired.version, '7.4.5');
assert.equal(repaired.changed, manifest.repairs.length + manifest.markdown.repairs.length + manifest.generated.length);
assert.equal(repairAstroTypes().changed, 0);
assert.equal(repairAstroTypes({ check: true }).changed, 0);
assert.equal(invokeRepair({ root: nested, installationRoot: process.env.ASTRO_REPAIR_INSTALLATION_ROOT ?? process.cwd(), check: true }).changed, 0);
rmSync(nested, { recursive: true });

// A known mixed original/repaired state can be completed safely after an interrupted run.
const first = manifest.repairs[0].path;
replace(join(astro, first), original.get(first));
assert.throws(() => repairAstroTypes({ check: true }), /has not been applied/u);
assert.equal(repairAstroTypes().changed, 1);
assert.equal(repairAstroTypes({ check: true }).changed, 0);

for (const [path, bytes] of original) {
  if (!manifest.repairs.some((repair) => repair.path === path)) {
    assert.deepEqual(readFileSync(join(astro, path)), bytes, path);
  }
}

for (const [path, bytes] of originalStorage) {
  assert.deepEqual(readFileSync(join(storage, path)), bytes, path);
}

for (const [path, bytes] of originalMarkdown) {
  if (!manifest.markdown.repairs.some((repair) => repair.path === path)) {
    assert.deepEqual(readFileSync(join(markdown, path)), bytes, path);
  }
}

for (const [path, sha256] of adapterHashes) {
  assert.equal(digest(readFileSync(join(adapter, 'dist/type-repair', path))), sha256, path);
}

