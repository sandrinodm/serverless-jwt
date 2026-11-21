import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runtimePort, spawnRuntime } from '../e2e/harness/src/runtime.ts';
import { startIssuer } from '../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../packages/testkit/src/keys.ts';
import { mintToken } from '../packages/testkit/src/tokens.ts';
import { verifyPackedSvelteTooling } from './tooling-security.mjs';

/**
 * Proves the exact installed package keeps its fail-closed seam through ordinary Node and real Vite
 * SSR.
 */
export async function verifySvelteKitConsumer(root, consumer, minimumNode, npm, before) {
  const timeout = 180_000;
  /**
   * Executes bounded exact-artifact probes without workspace aliases or dependency patches.
   */
  const run = (command, args) =>
    execFileSync(command, args, { cwd: consumer, timeout, stdio: 'inherit' });
  run(process.execPath, [
    npm,
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--before=' + before,
    '@sveltejs/adapter-node@6.0.1',
  ]);
  await verifyPackedSvelteTooling(consumer);
  writeFileSync(
    join(consumer, 'unregistered.cjs'),
    `
    const assert = require('node:assert/strict');
    const {jwtHandle} = require('@serverless-jwt/sveltekit');
    const {ConfigurationError} = require('@serverless-jwt/jwt-verifier');
    for (const protect of [['/api/**'], () => true]) {
      assert.throws(() => jwtHandle({issuer:'https://issuer.example',audience:'api',protect}), error => error instanceof ConfigurationError && error.reason === 'SvelteKit JWT policy registration is missing or mismatched');
    }
  `,
  );
  run(process.execPath, ['unregistered.cjs']);
  run(minimumNode, ['unregistered.cjs']);
  for (const directory of ['src/routes/api/me', 'src/routes/public', 'src/routes/ready']) {
    mkdirSync(join(consumer, directory), { recursive: true });
  }

  writeFileSync(
    join(consumer, 'src/app.html'),
    '<!doctype html><html lang="en"><head>%sveltekit.head%</head><body>%sveltekit.body%</body></html>',
  );
  writeFileSync(join(consumer, 'src/routes/+page.svelte'), '<h1>Public page</h1>');
  writeFileSync(
    join(consumer, 'src/routes/public/+server.ts'),
    "import type {RequestHandler} from '@sveltejs/kit'; export const prerender:boolean=true; export const GET:RequestHandler=()=>new Response('<h1>Public static</h1>',{headers:{'content-type':'text/html'}});",
  );
  writeFileSync(
    join(consumer, 'src/routes/ready/+server.ts'),
    "export function GET(): Response { return new Response('ready'); }",
  );
  const endpoint =
    "import type {RequestHandler} from '@sveltejs/kit'; import {requireAuth} from '@serverless-jwt/sveltekit'; export const prerender:boolean=false; export const GET:RequestHandler=({locals})=>Response.json({subject:requireAuth<{subject:string}>(locals).identity.subject});";
  writeFileSync(join(consumer, 'src/routes/api/me/+server.ts'), endpoint);
  const hook =
    "import type {Handle} from '@sveltejs/kit/hooks'; import {jwtHandle} from '@serverless-jwt/sveltekit'; export const handle:Handle=jwtHandle({issuer:process.env.ISSUER??'https://issuer.example',audience:'api',...(process.env.JWKS_URI?{jwksUri:process.env.JWKS_URI}:{}),mapClaims:()=>({subject:'packed-identity'}),protect:['/api/**']});";
  writeFileSync(join(consumer, 'src/hooks.server.ts'), hook);
  writeFileSync(
    join(consumer, 'vite.config.mjs'),
    `
    import {sveltekit} from '@sveltejs/kit/vite';
    import node from '@sveltejs/adapter-node';
    import {serverlessJwtAdapter} from '@serverless-jwt/sveltekit/build';
    const kind=process.env.PACKED_JWT_CASE;
    export default {plugins:[sveltekit({adapter:kind==='omitted'?node():serverlessJwtAdapter(node(),{protect:kind==='mismatch'?['/other/**']:kind==='encoded-base'?['/base/api/**']:['/api/**']}),paths:{base:kind==='encoded-base'?'/b%61se':''},prerender:{handleHttpError:'ignore',handleUnseenRoutes:'ignore'}})]};
  `,
  );
  for (const kind of ['registered', 'protected', 'omitted', 'mismatch', 'encoded-base']) {
    writeFileSync(
      join(consumer, 'src/hooks.server.ts'),
      kind === 'encoded-base'
        ? hook.replace("protect:['/api/**']", "protect:['/base/api/**']")
        : hook,
    );
    writeFileSync(
      join(consumer, 'src/routes/api/me/+server.ts'),
      kind === 'protected' || kind === 'encoded-base'
        ? endpoint.replace('prerender:boolean=false', 'prerender:boolean=true')
        : endpoint,
    );
    const result = spawnSync(
      process.execPath,
      [join(consumer, 'node_modules/vite/bin/vite.js'), 'build'],
      {
        cwd: consumer,
        timeout,
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '', NODE_ENV: 'production', PACKED_JWT_CASE: kind },
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, kind === 'registered' ? 0 : 1, result.stdout + result.stderr);
    if (kind === 'registered') {
      assert.ok(existsSync(join(consumer, 'build/prerendered/public.html')));
      assert.ok(!existsSync(join(consumer, 'build/prerendered/api')));
    } else {
      assert.match(
        result.stdout + result.stderr,
        kind === 'protected' || kind === 'encoded-base'
          ? /Protected or unsupported SvelteKit route must not be prerendered/
          : /SvelteKit JWT policy registration is missing or mismatched/,
      );
    }
  }

  writeFileSync(join(consumer, 'src/routes/api/me/+server.ts'), endpoint);
  writeFileSync(join(consumer, 'src/hooks.server.ts'), hook);
  run(process.execPath, [join(consumer, 'node_modules/vite/bin/vite.js'), 'build']);
  writeFileSync(
    join(consumer, 'tsconfig.types.json'),
    JSON.stringify({
      extends: '$app/tsconfig',
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        isolatedDeclarations: true,
        declaration: true,
        allowJs: false,
        checkJs: false,
        types: ['node', '$app/types'],
      },
      include: ['src/**/*.ts', '.svelte-kit/types/**/*.d.ts'],
    }),
  );
  run(join(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.types.json']);
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
    args: ['build/index.js'],
    cwd: consumer,
    url: 'http://127.0.0.1:' + port,
    tokens: [token],
    env: {
      PATH: process.env.PATH ?? '',
      HOST: '127.0.0.1',
      PORT: String(port),
      ORIGIN: 'http://127.0.0.1:' + port,
      ISSUER: issuer.url,
      JWKS_URI: issuer.url + '/jwks',
      NODE_EXTRA_CA_CERTS: join(root, 'packages/testkit/fixtures/ca.crt'),
      NODE_TLS_REJECT_UNAUTHORIZED: '1',
    },
  });
  try {
    assert.equal((await fetch(app.url + '/api/me')).status, 401);
    const response = await fetch(app.url + '/%61pi/me', {
      headers: { authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { subject: 'packed-identity' });
    assert.equal((await fetch(app.url + '/public')).status, 200);
  } finally {
    await app.close();
  }

  const manifest = JSON.parse(
    readFileSync(join(consumer, 'node_modules/vite/package.json'), 'utf8'),
  );
  console.log(
    'Verified packed SvelteKit policy bridge, strict generated types and real JWT SSR on Vite ' +
      manifest.version +
      '.',
  );
}
