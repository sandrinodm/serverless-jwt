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
  applyRouterLoggingPatch,
  assertRouterLoggingPatch,
} from '../../../scripts/router-logging.ts';

it('rejects changed Router bytes/version and applies only the exact native access-logger patch', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-router-patch-'));
  const installed = resolve(
    import.meta.dirname,
    '../../apps/react-router/node_modules/@react-router/serve',
  );
  const target = join(directory.path, 'node_modules/@react-router/serve');
  mkdirSync(join(target, 'dist'), { recursive: true });
  copyFileSync(join(installed, 'package.json'), join(target, 'package.json'));
  const file = join(target, 'dist/cli.js');
  const patched = readFileSync(join(installed, 'dist/cli.js'), 'utf8');
  writeFileSync(file, patched);
  expect(() => assertRouterLoggingPatch(directory.path)).not.toThrow(
    'Expected values to be strictly equal',
  );
  writeFileSync(file, patched + '\n');
  expect(() => assertRouterLoggingPatch(directory.path)).toThrow('hash mismatch');
  expect(() => applyRouterLoggingPatch(directory.path)).toThrow('unreviewed Router CLI bytes');
  const original = patched
    .replace(
      'import express from "express";\n',
      'import express from "express";\nimport morgan from "morgan";\n',
    )
    .replace('\tif (build.fetch)', '\tapp.use(morgan("tiny"));\n\tif (build.fetch)');
  writeFileSync(file, original);
  expect(() => applyRouterLoggingPatch(directory.path)).not.toThrow(
    'Expected values to be strictly equal',
  );
  expect(readFileSync(file, 'utf8')).toBe(patched);
  writeFileSync(join(target, 'package.json'), JSON.stringify({ version: '8.5.2' }));
  expect(() => assertRouterLoggingPatch(directory.path)).toThrow(
    'Expected values to be strictly equal',
  );
  expect(() => applyRouterLoggingPatch(directory.path)).toThrow(
    'Expected values to be strictly equal',
  );
});
