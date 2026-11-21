import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempDisposableSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vite-plus/test';

import { snapshotApplication } from './release.ts';
import { prepareVercelDevelopment } from './vercel-development.ts';

it('emits the actual native fixture with exact TS7 and retains unauthenticated guard rejection', async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-vercel-stage-'));
  const source = resolve(import.meta.dirname, '../../apps/vercel');
  const app = snapshotApplication(source, directory.path);
  await prepareVercelDevelopment(source, app);
  const evidence = JSON.parse(readFileSync(join(app, '.e2e-native-development.json'), 'utf8'));
  expect(evidence.compiler).toBe('Version 7.0.2');
  expect(existsSync(join(app, 'api/me.ts'))).toBe(false);
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "const {GET}=await import('./api/me.mjs'); const response=await GET(new Request('http://localhost/api/me')); if(response.status!==401) throw new Error('Emitted native guard bypassed'); console.log(response.status);",
    ],
    { cwd: app, encoding: 'utf8', timeout: 10_000 },
  );
  expect(output.trim()).toBe('401');
}, 15_000);

it('rejects corrupted copied native source before emitting executable fixture bytes', async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-vercel-stage-negative-'));
  const source = resolve(import.meta.dirname, '../../apps/vercel');
  const app = snapshotApplication(source, directory.path);
  const route = join(app, 'api/me.ts');
  writeFileSync(
    route,
    readFileSync(route, 'utf8') +
      '\nconst invalidNativeStage: number = "corrupted copied bytes"; void invalidNativeStage;\n',
  );
  await expect(prepareVercelDevelopment(source, app)).rejects.toMatchObject({
    stdout: expect.stringContaining('TS2322'),
  });
  expect(existsSync(join(app, 'api/me.mjs'))).toBe(false);
  expect(existsSync(join(app, 'capabilities.mjs'))).toBe(false);
}, 15_000);
