import { resolve } from 'node:path';
import { expect, inject, it } from 'vite-plus/test';

import { wireStatus } from '../../../packages/testkit/src/conformance/node-wire.ts';
import { issuerTransport } from '../../../packages/testkit/src/issuer.ts';
import { runtimePort, spawnRuntime } from './runtime.ts';

for (const integration of [
  'express',
  'fastify',
  'aws-lambda',
  'netlify-v1',
  'nuxt-h3-v2',
  'nuxt',
  'next-pages',
] as const) {
  for (const predicate of integration === 'nuxt' || integration === 'nuxt-h3-v2'
    ? [false, true]
    : [false]) {
    // Real spawned applications and actual HTTPS OIDC grants justify the bounded 30-second timeout.
    it(
      'runs P5 ' +
        integration +
        (predicate ? ' predicate' : '') +
        ' with real OIDC, duplicate headers and concurrent identities',
      async () => {
        const issuer = inject('e2eUrls').oidc;
        const transport = issuerTransport();
        const tokens: string[] = [];
        let app: Awaited<ReturnType<typeof spawnRuntime>> | undefined;
        try {
          const credentials = await Promise.all(
            Array.from({ length: 200 }, async (_, index): Promise<string> => {
              const response = await transport.fetch(issuer + '/token', {
                method: 'POST',
                headers: {
                  authorization:
                    'Basic ' +
                    Buffer.from('client-' + index + ':synthetic-test-secret').toString('base64'),
                  'content-type': 'application/x-www-form-urlencoded',
                },
                body: 'grant_type=client_credentials&scope=read%20write&resource=https%3A%2F%2Fresource.example',
              });
              expect(response.status).toBe(200);
              const token = ((await response.json()) as { readonly access_token: string })
                .access_token;
              tokens.push(token);
              return token;
            }),
          );
          const cwd = resolve('e2e/apps', integration);
          const port = await runtimePort();
          app = await spawnRuntime({
            command: process.env.MIN_NODE_BIN ?? process.execPath,
            args:
              integration === 'next-pages'
                ? [
                    'node_modules/next/dist/bin/next',
                    'start',
                    '--hostname',
                    '127.0.0.1',
                    '--port',
                    String(port),
                  ]
                : [integration === 'nuxt' ? '.output/server/index.mjs' : 'src/app.ts'],
            cwd,
            env: {
              ISSUER: issuer,
              PROTECT_PREDICATE: predicate ? '1' : '0',
              PORT: String(port),
              HOST: '127.0.0.1',
              NODE_EXTRA_CA_CERTS: resolve('packages/testkit/fixtures/ca.crt'),
              NODE_TLS_REJECT_UNAUTHORIZED: '1',
            },
            url: 'http://127.0.0.1:' + port,
            tokens,
          });
          const nuxtPaths =
            integration === 'nuxt'
              ? ['/%70rotected', '/protected?ignored', '/protected%3Fignored']
              : integration === 'nuxt-h3-v2'
                ? ['/%70rotected', '/protected?ignored']
                : [];
          for (const path of nuxtPaths) {
            expect(await wireStatus(port, [], path), path).toBe(401);
            expect(await wireStatus(port, ['Bearer ' + credentials[0]], path), path).toBe(200);
          }

          const malformedPaths = nuxtPaths.length > 0 ? ['/bad%', '/bad%q0', '/bad%C0%AF'] : [];
          // Pattern policies reject malformed encodings; a false v1 predicate delegates public paths to Nuxt's fallback.
          const malformedStatus = predicate && integration === 'nuxt' ? 200 : 400;
          for (const path of malformedPaths) {
            expect(await wireStatus(port, [], path), path).toBe(malformedStatus);
          }

          for (const path of integration === 'aws-lambda'
            ? ['/protected/v1', '/protected/v2', '/protected/alb', '/protected/single']
            : integration === 'next-pages'
              ? ['/api/protected']
              : ['/protected']) {
            const missing = await fetch(app.url + path);
            expect(missing.status).toBe(401);
            expect(missing.headers.get('cache-control')).toBe('no-store');
            expect(missing.headers.get('www-authenticate')).toBe('Bearer realm="api"');
            expect(
              (
                await fetch(app.url + path, {
                  method: 'OPTIONS',
                  headers: { 'access-control-request-method': 'GET' },
                })
              ).status,
            ).toBe(401);
            for (let round = 0; round < 2; round++) {
              const identities = await Promise.all(
                credentials.map(async (token) => {
                  const response = await fetch(app?.url + path, {
                    headers: { authorization: 'Bearer ' + token },
                  });
                  expect(response.status).toBe(200);
                  return response.json() as Promise<{ readonly sub: string }>;
                }),
              );
              expect(identities.map((body) => body.sub)).toEqual(
                Array.from({ length: 200 }, (_, index) => 'client-' + index),
              );
            }

            const duplicateStatuses: number[] = [];
            if (!path.endsWith('/single')) {
              for (const values of [
                ['Bearer ' + credentials[0], 'Basic invalid'],
                ['Basic invalid', 'Bearer ' + credentials[0]],
              ]) {
                duplicateStatuses.push(await wireStatus(port, values, path));
              }
            }

            expect(duplicateStatuses).toEqual(path.endsWith('/single') ? [] : [400, 400]);
          }
        } finally {
          try {
            await app?.close();
          } finally {
            await transport.close();
          }
        }
      },
      30_000,
    );
  }
}
