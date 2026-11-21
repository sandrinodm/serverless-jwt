import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';

import { optionBounds, validateOptions } from '../packages/jwt-verifier/src/options.ts';
import { assertMetadataCoverage, checkReferences, renderReferences } from './docs-reference.mjs';

test('metadata rejects additions, removals and nested key options without documentation', () => {
  const source =
    'export interface JwtVerifierOptions {\n readonly audience: string;\n}\nexport interface KeyOptions {\n readonly timeout?: number;\n}';
  assertMetadataCoverage(source, { audience: 'API', 'keys.timeout': 'Deadline' });
  assert.throws(() => assertMetadataCoverage(source, { audience: 'API' }), /Option metadata drift/);
  assert.throws(
    () =>
      assertMetadataCoverage(source, {
        audience: 'API',
        'keys.timeout': 'Deadline',
        obsolete: 'removed',
      }),
    /Option metadata drift/,
  );
});

test('generated references reject stale checked-in text and render actual status/header contracts', async () => {
  const references = await renderReferences();
  assert.match(references['configuration.md'], /cacheMaxAge/);
  assert.match(references['errors.md'], /Retry-After/);
  assert.match(references['errors.md'], /503/);
  const directory = mkdtempSync(join(tmpdir(), 'jwt-docs-drift-'));
  try {
    for (const [name, text] of Object.entries(references)) {
      writeFileSync(join(directory, name), text);
    }

    checkReferences(directory, references);
    writeFileSync(join(directory, 'errors.md'), references['errors.md'].replace('503', '401'));
    assert.throws(() => checkReferences(directory, references), /Reference drift in errors.md/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('every documented numeric validation range matches the actual validator', () => {
  for (const [name, [minimum, maximum]] of Object.entries(optionBounds)) {
    const option = (value) =>
      name.startsWith('keys.') ? { keys: { [name.slice(5)]: value } } : { [name]: value };
    for (const value of [minimum, maximum]) {
      const resolved = validateOptions({
        issuer: 'https://issuer.example',
        audience: 'api',
        ...option(value),
      });
      assert.equal(
        name.startsWith('keys.') ? resolved.keys[name.slice(5)] : resolved[name],
        value,
        name,
      );
    }

    for (const value of [minimum - 1, maximum + 1, NaN, Infinity, '1', 0.5]) {
      assert.throws(
        () =>
          validateOptions({ issuer: 'https://issuer.example', audience: 'api', ...option(value) }),
        { reason: 'invalid_numeric_option' },
        name,
      );
    }
  }
});
