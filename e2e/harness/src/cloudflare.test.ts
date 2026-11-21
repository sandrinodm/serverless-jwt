import { mkdtempDisposableSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, inject, it } from 'vite-plus/test';

import type { spawnRuntime } from './runtime.ts';

import { issuerTransport } from '../../../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../../../packages/testkit/src/keys.ts';
import { mintToken } from '../../../packages/testkit/src/tokens.ts';
import { cloudflareApp } from './cloudflare.ts';

for (const form of ['workers', 'pages'] as const) {
  // Each named case starts an actual CLI and exercises HTTPS OIDC plus two warmed identity rounds.
  it(
    'runs real Wrangler ' + form + ' with verified OIDC discovery and 200 distinct identities',
    async () => {
      using config = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-wrangler-'));
      const issuer = inject('e2eUrls').oidc;
      const transport = issuerTransport();
      const tokens: string[] = [];
      let app: Awaited<ReturnType<typeof spawnRuntime>> | undefined;
      const path = form === 'workers' ? '/protected' : '/api/me';
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
        app = await cloudflareApp(form, issuer, tokens, config.path);
        const missing = await fetch(app.url + path);
        expect(missing.status).toBe(401);
        expect(missing.headers.get('cache-control')).toBe('no-store');
        expect(missing.headers.get('www-authenticate')).toBe('Bearer realm="api"');
        const forged = await fetch(app.url + path, {
          method: 'OPTIONS',
          headers: { 'access-control-request-method': 'GET' },
        });
        expect(forged.status).toBe(401);
        const warmed = await fetch(app.url + path, {
          headers: { authorization: 'Bearer ' + credentials[0] },
        });
        expect(warmed.status).toBe(200);
        for (let round = 0; round < 2; round++) {
          const responses = await Promise.all(
            credentials.map(async (credential) => {
              const response = await fetch(app?.url + path, {
                headers: { authorization: 'Bearer ' + credential },
              });
              expect(response.status).toBe(200);
              return response.json() as Promise<{ readonly sub: string }>;
            }),
          );
          responses.forEach((body, index) => expect(body.sub).toBe('client-' + index));
        }

        const comma = await fetch(app.url + path, {
          headers: { authorization: 'Bearer ' + credentials[0] + ', Bearer invalid' },
        });
        expect(comma.status).toBe(400);
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

// This bounded negative/positive pair runs separate untrusted and trusted workerd processes.
it('rejects the fixture CA without explicit trust and verifies the same issuer with it', async () => {
  using config = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-wrangler-tls-'));
  const issuer = inject('e2eUrls').hostile;
  const token = await mintToken({
    key: fixtureKey(2048),
    header: {},
    payload: {
      iss: issuer,
      aud: 'https://resource.example',
      sub: 'native-tls',
      exp: Math.floor(Date.now() / 1000) + 300,
    },
  });
  for (const trusted of [false, true]) {
    const app = await cloudflareApp(
      'workers',
      issuer,
      [token],
      config.path,
      issuer + '/jwks',
      trusted,
    );
    try {
      const response = await fetch(app.url + '/protected', {
        headers: { authorization: 'Bearer ' + token },
      });
      expect(response.status).toBe(trusted ? 200 : 503);
      expect(response.headers.get('retry-after')).toBe(trusted ? null : '1');
    } finally {
      await app.close();
    }
  }
}, 15_000);
