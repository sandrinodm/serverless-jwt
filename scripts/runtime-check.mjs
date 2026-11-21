import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempDisposableSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite-plus';

import { startIssuer } from '../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../packages/testkit/src/keys.ts';
import { mintToken } from '../packages/testkit/src/tokens.ts';

/**
 * Child runtimes must settle while the Node parent continues serving verified HTTPS.
 */
async function run(executable, args, environment) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: 'inherit',
      env: { ...process.env, ...environment },
    });
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Runtime suite exceeded 60 seconds'));
    }, 60_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Runtime suite exited ${code}`));
      }
    });
  });
}

/**
 * Runs a shared Web API suite in a real runtime with a separate Node HTTPS issuer.
 */
async function main() {
  const runtime = process.argv[2];
  assert.ok(
    ['workerd', 'deno', 'bun'].includes(runtime),
    'Usage: runtime-check.mjs workerd|deno|bun',
  );
  const key = fixtureKey(2048);
  await using issuer = await startIssuer({ script: () => ({}) });
  issuer.setScript((path) => ({
    delay: 20,
    json: path.startsWith('/.well-known')
      ? { issuer: issuer.url, jwks_uri: `${issuer.url}/jwks` }
      : { keys: [key.jwk] },
  }));
  const seconds = Math.floor(Date.now() / 1000);
  const mint = (expiration) =>
    mintToken({
      key,
      header: {},
      payload: {
        iss: issuer.url,
        aud: 'api',
        sub: 'portable',
        scope: 'read write',
        exp: expiration,
      },
    });
  const input = {
    issuer: issuer.url,
    token: await mint(seconds + 300),
    expired: await mint(seconds - 10),
  };
  const ca = resolve('packages/testkit/fixtures/ca.crt');
  const environment = {
    PORTABLE_INPUT: JSON.stringify(input),
    NODE_EXTRA_CA_CERTS: ca,
    NODE_TLS_REJECT_UNAUTHORIZED: '1',
  };
  if (runtime === 'workerd') {
    await run(
      'pnpm',
      ['exec', 'vp', 'test', 'run', '--config', 'scripts/portable.config.mjs'],
      environment,
    );
  } else {
    using temporary = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-runtime-'));
    await build({
      configFile: false,
      build: {
        target: 'es2023',
        outDir: temporary.path,
        emptyOutDir: false,
        minify: false,
        lib: {
          entry: resolve('packages/jwt-verifier/src/portable/suite.spec.ts'),
          formats: ['es'],
          fileName: () => 'suite.mjs',
        },
      },
    });
    const runner = join(temporary.path, 'runtime.test.mjs');
    if (runtime === 'deno') {
      writeFileSync(
        runner,
        "import {portableSuite} from './suite.mjs';\nportableSuite(JSON.parse(Deno.env.get('PORTABLE_INPUT')),(name,run)=>Deno.test(name,run));\n",
      );
      await run(
        process.env.DENO_BIN ?? 'deno',
        ['test', '--allow-net=127.0.0.1', '--allow-env=PORTABLE_INPUT', `--cert=${ca}`, runner],
        environment,
      );
    } else {
      writeFileSync(
        runner,
        "import {test} from 'bun:test';\nimport {portableSuite} from './suite.mjs';\nportableSuite(JSON.parse(process.env.PORTABLE_INPUT),(name,run)=>test(name,run));\n",
      );
      await run(process.env.BUN_BIN ?? 'bun', ['test', runner], environment);
    }
  }

  assert.ok(
    (issuer.hits['/.well-known/openid-configuration'] ?? 0) > 0,
    'Runtime did not contact the external issuer',
  );
  assert.ok((issuer.hits['/jwks'] ?? 0) > 0, 'Runtime did not fetch signing keys');
  console.log(`${runtime}: verified HTTPS issuer requests ${JSON.stringify(issuer.hits)}`);
}
await main();
