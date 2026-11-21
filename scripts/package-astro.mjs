import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runtimePort, spawnRuntime } from '../e2e/harness/src/runtime.ts';
import { startIssuer } from '../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../packages/testkit/src/keys.ts';
import { mintToken } from '../packages/testkit/src/tokens.ts';

/**
 * Runs the ordinary installed Astro package through native production policy, type and JWT proofs.
 */
export async function verifyAstroConsumer(root, consumer, minimumNode, npm, before) {
  const timeout = 180_000;
  /**
   * Bounds real package commands, including the same explicit declaration repair documented for
   * consumers.
   */
  const run = (command, args) =>
    execFileSync(command, args, {
      cwd: consumer,
      timeout,
      stdio: 'inherit',
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
    });
  run(process.execPath, [
    npm,
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--before=' + before,
    '@astrojs/node@11.1.9',
  ]);
  cpSync(join(root, 'packages/astro/fixtures/type-repair.mjs'), join(consumer, 'type-repair.mjs'));
  run(process.execPath, ['type-repair.mjs']);
  run(process.execPath, [
    '--input-type=module',
    '-e',
    "import { repairAstroTypes } from '@serverless-jwt/astro/type-repair'; repairAstroTypes()",
  ]);
  run(minimumNode, [
    '--input-type=module',
    '-e',
    "import { repairAstroTypes } from '@serverless-jwt/astro/type-repair'; repairAstroTypes({ check: true })",
  ]);
  writeFileSync(
    join(consumer, 'unregistered.cjs'),
    `
    const assert=require('node:assert/strict'); const {jwtMiddleware}=require('@serverless-jwt/astro'); const {ConfigurationError}=require('@serverless-jwt/jwt-verifier');
    for(const protect of [['/api/**'],()=>true]) assert.throws(()=>jwtMiddleware({issuer:'https://issuer.example',audience:'api',protect}), error=>error instanceof ConfigurationError && error.reason==='Astro JWT policy registration is missing or mismatched');
  `,
  );
  run(process.execPath, ['unregistered.cjs']);
  run(minimumNode, ['unregistered.cjs']);
  mkdirSync(join(consumer, 'src/pages/api'), { recursive: true });
  writeFileSync(
    join(consumer, 'src/pages/index.astro'),
    '---\nexport const prerender=true;\n---\n<h1>Public static</h1>',
  );
  writeFileSync(
    join(consumer, 'src/pages/ready.ts'),
    "import type {APIRoute} from 'astro'; export const GET:APIRoute=()=>new Response('ready');",
  );
  const endpoint =
    "import type {APIRoute} from 'astro'; import {requireAuth} from '@serverless-jwt/astro';\nexport const prerender = false as const;\nexport const GET:APIRoute=({locals})=>Response.json({subject:requireAuth<{subject:string}>(locals).identity.subject});";
  const hook =
    "import type {MiddlewareHandler} from 'astro'; import {jwtMiddleware} from '@serverless-jwt/astro'; export const onRequest:MiddlewareHandler=jwtMiddleware({issuer:process.env.ISSUER??'https://issuer.example',audience:'api',...(process.env.JWKS_URI?{jwksUri:process.env.JWKS_URI}:{}),mapClaims:()=>({subject:'packed-identity'}),protect:['/api/**']});";
  writeFileSync(join(consumer, 'src/pages/api/me.ts'), endpoint);
  writeFileSync(join(consumer, 'src/middleware.ts'), hook);
  writeFileSync(
    join(consumer, 'astro.config.mjs'),
    `
    import {defineConfig} from 'astro/config'; import node from '@astrojs/node'; import {serverlessJwt} from '@serverless-jwt/astro/build'; import {writeFileSync} from 'node:fs';
    const kind=process.env.PACKED_JWT_CASE; const guard=serverlessJwt({protect:kind==='mismatch'?['/other/**']:kind==='encoded-base'?['/base/api/**']:['/api/**']});
    const checked={...guard,hooks:{...guard.hooks,'astro:routes:resolved':data=>{writeFileSync('packed-routes.json',JSON.stringify(data.routes.map(route=>({pattern:route.pattern,isPrerendered:route.isPrerendered}))));return guard.hooks['astro:routes:resolved'](data);},'astro:build:done':async(data)=>{try{await guard.hooks['astro:build:done'](data);}catch(error){writeFileSync('guard-failure.json',JSON.stringify({reason:error.reason}));throw error;}}}};
    export default defineConfig({output:'server',base:kind==='encoded-base'?'/b%61se':'/',adapter:node({mode:'standalone'}),integrations:kind==='omitted'?[]:[checked]});
  `,
  );
  for (const kind of ['registered', 'protected', 'omitted', 'mismatch', 'encoded-base']) {
    rmSync(join(consumer, 'guard-failure.json'), { force: true });
    rmSync(join(consumer, 'packed-routes.json'), { force: true });
    writeFileSync(
      join(consumer, 'src/pages/api/me.ts'),
      kind === 'protected' || kind === 'encoded-base'
        ? endpoint.replace('prerender = false', 'prerender = true')
        : endpoint,
    );
    writeFileSync(
      join(consumer, 'src/middleware.ts'),
      kind === 'encoded-base'
        ? hook.replace("protect:['/api/**']", "protect:['/base/api/**']")
        : hook,
    );
    const result = spawnSync(
      process.execPath,
      [join(consumer, 'node_modules/astro/bin/astro.mjs'), 'build'],
      {
        cwd: consumer,
        timeout,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '',
          NODE_ENV: 'production',
          ASTRO_TELEMETRY_DISABLED: '1',
          PACKED_JWT_CASE: kind,
        },
      },
    );
    assert.ifError(result.error);
    if (kind === 'protected' || kind === 'encoded-base') {
      const routes = JSON.parse(readFileSync(join(consumer, 'packed-routes.json'), 'utf8'));
      assert.ok(
        routes.some((route) => route.pattern === '/api/me' && route.isPrerendered === true),
        'Packed Astro fixture did not create an actual protected prerendered route',
      );
    }

    assert.equal(
      result.status,
      kind === 'registered' ? 0 : 1,
      'Packed Astro case: ' + kind + '\n' + result.stdout + result.stderr,
    );
    if (kind === 'registered') {
      assert.ok(existsSync(join(consumer, 'dist/client/index.html')));
      assert.ok(!existsSync(join(consumer, 'dist/client/api')));
    } else if (kind === 'omitted' || kind === 'mismatch') {
      assert.match(result.stdout + result.stderr, /assertRegistration/u);
    } else {
      const failure = JSON.parse(readFileSync(join(consumer, 'guard-failure.json'), 'utf8'));
      assert.equal(failure.reason, 'Protected Astro routes must not be prerendered');
    }
  }

  writeFileSync(join(consumer, 'src/pages/api/me.ts'), endpoint);
  writeFileSync(join(consumer, 'src/middleware.ts'), hook);
  run(process.execPath, [join(consumer, 'node_modules/astro/bin/astro.mjs'), 'build']);
  writeFileSync(
    join(consumer, 'tsconfig.app.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        isolatedDeclarations: true,
        declaration: true,
        target: 'ES2023',
        module: 'nodenext',
        moduleResolution: 'nodenext',
        types: ['node', 'astro/client'],
        lib: ['ES2023', 'DOM', 'DOM.Iterable'],
      },
      include: ['src/**/*.ts', '.astro/types.d.ts'],
    }),
  );
  run(join(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.app.json']);
  const key = fixtureKey(2048);
  await using issuer = await startIssuer({ script: () => ({ json: { keys: [key.jwk] } }) });
  const token = await mintToken({
    key,
    header: {},
    payload: { iss: issuer.url, aud: 'api', exp: Math.floor(Date.now() / 1000) + 300 },
  });
  const port = await runtimePort();
  const app = await spawnRuntime({
    command: process.execPath,
    args: ['dist/server/entry.mjs'],
    cwd: consumer,
    url: 'http://127.0.0.1:' + port,
    tokens: [token],
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      ISSUER: issuer.url,
      JWKS_URI: issuer.url + '/jwks',
      ASTRO_TELEMETRY_DISABLED: '1',
      NODE_EXTRA_CA_CERTS: join(root, 'packages/testkit/fixtures/ca.crt'),
      NODE_TLS_REJECT_UNAUTHORIZED: '1',
    },
  });
  try {
    assert.equal((await fetch(app.url + '/api/me')).status, 401);
    const response = await fetch(app.url + '/%2561pi/me', {
      headers: { authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { subject: 'packed-identity' });
    assert.equal((await fetch(app.url + '/')).status, 200);
  } finally {
    await app.close();
  }

  console.log(
    'Verified packed Astro policy bridge, native strict app types and real JWT standalone runtime.',
  );
}
