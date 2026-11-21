import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';

/**
 * Pins the exact published declarations and narrow private SDK repairs.
 */
const evidence: ReadonlyArray<{
  readonly package: string;
  readonly version: string;
  readonly file: string;
  readonly originalSha256: string;
  readonly patchedSha256: string;
}> = JSON.parse(readFileSync(new URL('../e2e/solidstart-sdk-patch.json', import.meta.url), 'utf8'));

/**
 * Rejects changed SDK versions or declarations before cached native output can run.
 */
export function assertSolidStartSdkPatch(application: string): void {
  for (const entry of evidence) {
    const root = join(application, 'node_modules', entry.package);
    assert.equal(
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
      entry.version,
    );
    const hash = createHash('sha256')
      .update(readFileSync(join(root, entry.file)))
      .digest('hex');
    assert.equal(hash, entry.patchedSha256, 'SolidStart SDK declaration patch hash mismatch');
  }
}

/**
 * Repairs only published optional fields already accepted by derived real SDK types and runtime.
 */
export function applySolidStartSdkPatch(application: string): void {
  const applicationRoot = realpathSync(application) + sep;
  for (const entry of evidence) {
    const root = join(application, 'node_modules', entry.package);
    const packageRoot = realpathSync(root) + sep;
    assert.ok(packageRoot.startsWith(applicationRoot), 'SDK patch package escaped isolated app');
    assert.ok(
      realpathSync(join(root, 'package.json')).startsWith(packageRoot),
      'SDK patch manifest escaped package',
    );
    assert.ok(
      realpathSync(join(root, entry.file)).startsWith(packageRoot),
      'SDK patch declaration escaped package',
    );
    assert.equal(
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
      entry.version,
    );
    const file = join(root, entry.file);
    const source = readFileSync(file, 'utf8');
    const hash = createHash('sha256').update(source).digest('hex');
    if (hash === entry.patchedSha256) {
      continue;
    }

    assert.equal(hash, entry.originalSha256, 'Refusing to patch unreviewed SolidStart SDK bytes');
    let patched: string;
    if (entry.package === '@solidjs/router') {
      patched = source
        .replace('            noScroll?: boolean;', '            noScroll?: boolean | undefined;')
        .replace('            replace?: boolean;', '            replace?: boolean | undefined;');
    } else {
      const start = source.indexOf('export interface ErrorBody<');
      const end = source.indexOf('\n/**\n * HTTPError', start);
      assert.ok(start >= 0 && end > start);
      const body = source
        .slice(start, end)
        .replace('statusText?: string;', 'statusText?: string | undefined;')
        .replace('unhandled?: boolean;', 'unhandled?: boolean | undefined;')
        .replace('data?: DataT;', 'data?: DataT | undefined;')
        .replace('body?: Record<string, unknown>;', 'body?: Record<string, unknown> | undefined;');
      patched = source.slice(0, start) + body + source.slice(end);
    }

    assert.equal(createHash('sha256').update(patched).digest('hex'), entry.patchedSha256);
    writeFileSync(file, patched);
  }

  assertSolidStartSdkPatch(application);
}
