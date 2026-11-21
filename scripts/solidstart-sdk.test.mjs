import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, it } from 'vite-plus/test';

import { applySolidStartSdkPatch, assertSolidStartSdkPatch } from './solidstart-sdk.ts';

/**
 * Copies only actual installed SDK manifests and reviewed declarations for attestation tests.
 */
function sdkFixture(directory) {
  const app = resolve(import.meta.dirname, '../e2e/apps/solidstart');
  for (const [name, file] of [
    ['@solidjs/router', 'dist/components.d.ts'],
    ['h3', 'dist/h3.d.mts'],
  ]) {
    const target = join(directory, 'node_modules', name);
    mkdirSync(dirname(join(target, file)), { recursive: true });
    cpSync(join(app, 'node_modules', name, file), join(target, file));
    cpSync(join(app, 'node_modules', name, 'package.json'), join(target, 'package.json'));
  }

  return directory;
}

it('attests the actual installed SDK declarations and applies idempotently', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'solidstart-sdk-'));
  const app = sdkFixture(directory.path);
  const declaration = join(app, 'node_modules/h3/dist/h3.d.mts');
  const before = createHash('sha256').update(readFileSync(declaration)).digest('hex');
  assertSolidStartSdkPatch(app);
  applySolidStartSdkPatch(app);
  expect(createHash('sha256').update(readFileSync(declaration)).digest('hex')).toBe(before);
});

it('rejects unreviewed SDK declaration bytes before applying or trusting the patch', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'solidstart-sdk-'));
  const app = sdkFixture(directory.path);
  const declaration = join(app, 'node_modules/h3/dist/h3.d.mts');
  writeFileSync(declaration, readFileSync(declaration, 'utf8') + '\n// unreviewed change\n');
  expect(() => applySolidStartSdkPatch(app)).toThrow(
    'Refusing to patch unreviewed SolidStart SDK bytes',
  );
  expect(() => assertSolidStartSdkPatch(app)).toThrow(
    'SolidStart SDK declaration patch hash mismatch',
  );
});

it('rejects an unreviewed SDK version even when declaration bytes match', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'solidstart-sdk-'));
  const app = sdkFixture(directory.path);
  const manifest = join(app, 'node_modules/@solidjs/router/package.json');
  const value = JSON.parse(readFileSync(manifest, 'utf8'));
  writeFileSync(manifest, JSON.stringify({ ...value, version: '1.0.2' }));
  expect(() => applySolidStartSdkPatch(app)).toThrow();
  expect(() => assertSolidStartSdkPatch(app)).toThrow();
});

it('repairs original published SDK declaration bytes to the exact reviewed hashes', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'solidstart-sdk-'));
  const app = sdkFixture(directory.path);
  const router = join(app, 'node_modules/@solidjs/router/dist/components.d.ts');
  writeFileSync(
    router,
    readFileSync(router, 'utf8')
      .replace('            noScroll?: boolean | undefined;', '            noScroll?: boolean;')
      .replace('            replace?: boolean | undefined;', '            replace?: boolean;'),
  );
  const h3 = join(app, 'node_modules/h3/dist/h3.d.mts');
  writeFileSync(
    h3,
    readFileSync(h3, 'utf8')
      .replace('  statusText?: string | undefined;', '  statusText?: string;')
      .replace('  unhandled?: boolean | undefined;', '  unhandled?: boolean;')
      .replace('  data?: DataT | undefined;', '  data?: DataT;')
      .replace(
        '  body?: Record<string, unknown> | undefined;',
        '  body?: Record<string, unknown>;',
      ),
  );
  expect(() => assertSolidStartSdkPatch(app)).toThrow(
    'SolidStart SDK declaration patch hash mismatch',
  );
  applySolidStartSdkPatch(app);
  assertSolidStartSdkPatch(app);
});

it('refuses SDK declaration writes that resolve outside the isolated package', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'solidstart-sdk-'));
  const app = sdkFixture(directory.path);
  const declaration = join(app, 'node_modules/h3/dist/h3.d.mts');
  const outside = join(directory.path, 'outside.d.mts');
  cpSync(declaration, outside);
  const before = readFileSync(outside, 'utf8');
  rmSync(declaration);
  symlinkSync(outside, declaration);
  expect(() => applySolidStartSdkPatch(app)).toThrow('SDK patch declaration escaped package');
  expect(readFileSync(outside, 'utf8')).toBe(before);
});
