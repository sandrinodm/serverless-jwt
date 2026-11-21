import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { transformWithOxc } from 'vite-plus';

/**
 * Emits the same strictly checked Web fixture as native ESM, avoiding per-request TS loaders.
 * Vercel dev still owns routing, request/context creation and its nonpersistent function workers.
 */
export async function prepareVercelDevelopment(source: string, app: string): Promise<void> {
  const root = resolve(import.meta.dirname, '../../..');
  const compiler = join(root, 'node_modules/.bin/tsc');
  const version = execFileSync(compiler, ['--version'], { encoding: 'utf8' }).trim();
  assert.equal(version, 'Version 7.0.2', 'Native fixture source checks require exact TS7');
  const project = join(app, '.e2e-native-tsconfig.json');
  writeFileSync(
    project,
    JSON.stringify({
      extends: join(source, 'tsconfig.types.json'),
      include: ['api/**/*.ts', 'capabilities.ts'],
      exclude: [],
    }) + '\n',
  );
  execFileSync(compiler, ['-p', project], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  const files = [];
  for (const name of ['capabilities.ts', 'api/me.ts', 'api/ready.ts']) {
    const original = readFileSync(join(app, name), 'utf8');
    const transformed = await transformWithOxc(original, join(app, name));
    const code = transformed.code
      .replaceAll("'../capabilities.ts'", "'../capabilities.mjs'")
      .replaceAll('"../capabilities.ts"', '"../capabilities.mjs"');
    assert.ok(!code.includes('../capabilities.ts'), 'Native ESM must import emitted fixture bytes');
    const output = name.slice(0, -3) + '.mjs';
    writeFileSync(join(app, output), code);
    rmSync(join(app, name));
    files.push({
      source: name,
      output,
      sourceSha256: createHash('sha256').update(original).digest('hex'),
      outputSha256: createHash('sha256').update(code).digest('hex'),
    });
  }

  const evidence = JSON.stringify({ compiler: version, files }, null, 2) + '\n';
  writeFileSync(join(app, '.e2e-native-development.json'), evidence);
  mkdirSync(join(root, 'reports/e2e'), { recursive: true });
  writeFileSync(join(root, 'reports/e2e/vercel-development.json'), evidence);
}
