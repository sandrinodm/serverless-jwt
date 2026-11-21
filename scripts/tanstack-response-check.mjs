import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempDisposableSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { runtimePort } from '../e2e/harness/src/runtime.ts';

/**
 * Proves actual Nitro global replacement happens before authentication factory use in both apps.
 */
const root = resolve(import.meta.dirname, '..');
/**
 * Native negative controls retain fixed configuration diagnostics and their actual HTTP outcomes.
 */
const results = [];
for (const framework of ['react', 'solid']) {
  using configuration = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-start-response-'));
  const directory = resolve(root, 'e2e/apps/tanstack-start', framework);
  const environment = {
    PATH: process.env.PATH ?? '',
    NODE_ENV: 'production',
    P4_NITRO_FAST_RESPONSE: '1',
    XDG_CONFIG_HOME: configuration.path,
  };
  rmSync(resolve(directory, '.output'), { recursive: true, force: true });
  execFileSync(
    'pnpm',
    [
      'exec',
      'vp',
      'build',
      '--config',
      resolve(directory, '..', 'vite.' + framework + '.app.config.ts'),
    ],
    { cwd: directory, env: environment, timeout: 180_000, stdio: 'inherit' },
  );
  const port = await runtimePort();
  const child = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: directory,
    env: { PATH: environment.PATH, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise((resolve) => {
    child.once('exit', () => resolve(true));
    child.once('error', () => resolve(true));
  });
  let log = '';
  const collect = (chunk) => {
    log += String(chunk);
    if (log.length > 65_536) {
      child.kill('SIGKILL');
    }
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  try {
    let response;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        response = await fetch('http://127.0.0.1:' + port + '/ready', {
          signal: AbortSignal.timeout(200),
        });
        break;
      } catch {
        await delay(20);
      }
    }

    assert.ok(response, 'Misconfigured native server did not return a bounded response');
    assert.equal(response.status, 500, 'Misconfigured factory must not produce a working app');
    await response.text();
    const api = await fetch('http://127.0.0.1:' + port + '/api/me', {
      signal: AbortSignal.timeout(1000),
    });
    assert.equal(api.status, 500);
    await api.text();
    assert.ok(
      log.includes('TanStack Start requires native Response semantics'),
      'Native factory must expose only the fixed configuration failure',
    );
    assert.ok(log.length <= 65_536, 'Native failure log exceeded its bound');
    results.push({
      framework,
      readyStatus: response.status,
      protectedStatus: api.status,
      fixedConfigurationFailure: true,
    });
  } finally {
    child.kill('SIGTERM');
    if (!(await Promise.race([exited, delay(2000, false, { ref: false })]))) {
      child.kill('SIGKILL');
      assert.ok(
        await Promise.race([exited, delay(2000, false, { ref: false })]),
        'Native child cleanup exceeded its bound',
      );
    }

    mkdirSync(resolve(root, 'reports/e2e'), { recursive: true });
    writeFileSync(resolve(root, 'reports/e2e/start-response-' + framework + '.log'), log);
  }
}

writeFileSync(
  resolve(root, 'reports/e2e/start-response.json'),
  JSON.stringify(results, null, 2) + '\n',
);
console.log('Verified actual Nitro Response incompatibility fails closed for React and Solid.');
