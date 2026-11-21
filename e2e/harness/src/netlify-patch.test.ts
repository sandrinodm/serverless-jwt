import {
  copyFileSync,
  mkdtempDisposableSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vite-plus/test';

import {
  applyNetlifyLoggingPatch,
  assertNetlifyLoggingPatch,
} from '../../../scripts/netlify-logging.ts';

it('requires reviewed CLI bytes, fails on hash mismatch and preserves the exact narrow patch', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-cli-patch-'));
  const installed = resolve(import.meta.dirname, '../../apps/netlify/node_modules/netlify-cli');
  const target = join(directory.path, 'node_modules/netlify-cli');
  mkdirSync(join(target, 'dist/lib/functions'), { recursive: true });
  copyFileSync(join(installed, 'package.json'), join(target, 'package.json'));
  const file = join(target, 'dist/lib/functions/server.js');
  const patched = readFileSync(join(installed, 'dist/lib/functions/server.js'), 'utf8');
  writeFileSync(file, patched);
  expect(() => assertNetlifyLoggingPatch(directory.path)).not.toThrow();
  expect(() => applyNetlifyLoggingPatch(directory.path)).not.toThrow();
  writeFileSync(file, patched + '\n');
  expect(() => assertNetlifyLoggingPatch(directory.path)).toThrow('hash mismatch');
  expect(() => applyNetlifyLoggingPatch(directory.path)).toThrow('unreviewed Netlify CLI bytes');
  const original = patched
    .replace(
      "import express from 'express';\n",
      "import express from 'express';\nimport expressLogging from 'express-logging';\n",
    )
    .replace(
      "    app.all('{*splat}', functionHandler);",
      "    app.use(expressLogging(console, {\n        blacklist: ['/favicon.ico'],\n    }));\n    app.all('{*splat}', functionHandler);",
    );
  writeFileSync(file, original);
  expect(() => applyNetlifyLoggingPatch(directory.path)).not.toThrow();
  expect(readFileSync(file, 'utf8')).toBe(patched);
});
