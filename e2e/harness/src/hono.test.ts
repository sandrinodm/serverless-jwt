import { mkdtempDisposableSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, inject, it } from 'vite-plus/test';

import { issuerTransport } from '../../../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../../../packages/testkit/src/keys.ts';
import { mintToken } from '../../../packages/testkit/src/tokens.ts';
import { spawnHono } from '../../apps/hono/src/runtime.ts';

for (const runtime of (['node', 'bun', 'deno', 'workerd'] as const).filter(
  (host) => !process.env.E2E_RUNTIME || host === process.env.E2E_RUNTIME,
)) {
  // Each real host starts a native HTTP listener and verifies two concurrent 200-client rounds.
  it(
    'runs real Hono on ' + runtime + ' with verified HTTPS OIDC and request isolation',
    async () => {
      using config = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-hono-' + runtime + '-'));
      const issuer = inject('e2eUrls').oidc;
      const transport = issuerTransport();
      const tokens: string[] = [];
      let app: Awaited<ReturnType<typeof spawnHono>> | undefined;
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
        app = await spawnHono(runtime, issuer, tokens, config.path);
        const missing = await fetch(app.url + '/api/me');
        expect(missing.status).toBe(401);
        expect(missing.headers.get('www-authenticate')).toBe('Bearer realm="api"');
        expect(missing.headers.get('cache-control')).toBe('no-store');
        const forged = await fetch(app.url + '/api/me', {
          method: 'OPTIONS',
          headers: { 'access-control-request-method': 'GET' },
        });
        expect(forged.status).toBe(401);
        const comma = await fetch(app.url + '/api/me', {
          headers: { authorization: 'Bearer ' + credentials[0] + ', Bearer invalid' },
        });
        expect(comma.status).toBe(400);
        const warmed = await fetch(app.url + '/api/me', {
          headers: { authorization: 'Bearer ' + credentials[0] },
        });
        expect(warmed.status).toBe(200);
        for (let round = 0; round < 2; round++) {
          const responses = await Promise.all(
            credentials.map(async (credential) => {
              const response = await fetch(app?.url + '/api/me', {
                headers: { authorization: 'Bearer ' + credential },
              });
              expect(response.status).toBe(200);
              return response.json() as Promise<{ readonly sub: string }>;
            }),
          );
          responses.forEach((body, index) => expect(body.sub).toBe('client-' + index));
        }

        for (const values of [
          [credentials[0], 'invalid'],
          ['invalid', credentials[0]],
        ]) {
          const status = await new Promise<number>((resolve, reject) => {
            const request = httpRequest(
              app?.url + '/api/me',
              { headers: { Authorization: values.map((value) => 'Bearer ' + value) } },
              (response) => {
                response.resume();
                response.once('end', () => resolve(response.statusCode ?? 0));
              },
            );
            request.once('error', reject);
            request.end();
          });
          expect(status).toBe(400);
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

  // Two actual host processes isolate invalid-credential and unavailable-key paths per runtime.
  it(
    'rejects invalid credentials and key outages on real Hono ' + runtime,
    async () => {
      using config = mkdtempDisposableSync(
        join(tmpdir(), 'serverless-jwt-hono-hostile-' + runtime + '-'),
      );
      const issuer = inject('e2eUrls').hostile;
      const tokens: string[] = [];
      const mint = async (audience: string): Promise<string> =>
        mintToken({
          key: fixtureKey(2048),
          header: {},
          payload: {
            iss: issuer,
            aud: audience,
            sub: 'hono-private',
            exp: Math.floor(Date.now() / 1000) + 300,
          },
        });
      const valid = await mint('https://resource.example');
      const invalid = await mint('private-hostile-audience');
      tokens.push(valid, invalid);
      for (const outage of [false, true]) {
        const app = await spawnHono(
          runtime,
          issuer,
          tokens,
          config.path,
          issuer + (outage ? '/outage' : '/jwks'),
        );
        try {
          const response = await fetch(app.url + '/api/me', {
            headers: { authorization: 'Bearer ' + (outage ? valid : invalid) },
          });
          expect(response.status).toBe(outage ? 503 : 401);
          expect(response.headers.get('cache-control')).toBe('no-store');
          expect(response.headers.get('retry-after')).toBe(outage ? '1' : null);
          expect(await response.text()).not.toContain('private-hostile-audience');
        } finally {
          await app.close();
        }
      }
    },
    15_000,
  );
}
