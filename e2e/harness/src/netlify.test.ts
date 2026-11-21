import { mkdirSync, mkdtempDisposableSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, inject, it } from 'vite-plus/test';

import { issuerTransport } from '../../../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../../../packages/testkit/src/keys.ts';
import { mintToken } from '../../../packages/testkit/src/tokens.ts';
import { spawnNetlify } from '../../apps/netlify/src/runtime.ts';

// Actual offline CLI supplies both platform contexts and serves two distinct 200-client rounds.
it('authenticates actual Netlify Functions v2 and Deno Edge with verified HTTPS OIDC and 200 distinct clients', async () => {
  using config = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-netlify-'));
  const issuer = inject('e2eUrls').oidc;
  const transport = issuerTransport();
  const tokens: string[] = [];
  let app: Awaited<ReturnType<typeof spawnNetlify>> | undefined;
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
        const token = ((await response.json()) as { readonly access_token: string }).access_token;
        tokens.push(token);
        return token;
      }),
    );
    app = await spawnNetlify(issuer, tokens, config.path);
    const ingress: Record<string, number[]> = {};
    for (const path of ['/.netlify/functions/me', '/edge/me']) {
      ingress[path] = [];
      const missing = await fetch(app.url + path);
      expect(missing.status).toBe(401);
      expect(missing.headers.get('cache-control')).toBe('no-store');
      expect(missing.headers.get('www-authenticate')).toBe('Bearer realm="api"');
      const forged = await fetch(app.url + path, {
        method: 'OPTIONS',
        headers: { 'access-control-request-method': 'GET' },
      });
      expect(forged.status).toBe(401);
      for (let round = 0; round < 2; round++) {
        const responses = await Promise.all(
          credentials.map(async (credential) => {
            const response = await fetch(app?.url + path, {
              headers: { authorization: 'Bearer ' + credential },
            });
            expect(response.status).toBe(200);
            return response.json() as Promise<{
              readonly sub: string;
              readonly context: boolean;
              readonly request: boolean;
            }>;
          }),
        );
        responses.forEach((body, index) =>
          expect(body).toMatchObject({ sub: 'client-' + index, context: true, request: true }),
        );
      }

      for (const values of [
        [credentials[0], 'invalid'],
        ['invalid', credentials[0]],
      ]) {
        const status = await new Promise<number>((resolve, reject) => {
          const request = httpRequest(
            app?.url + path,
            { headers: { Authorization: values.map((value) => 'Bearer ' + value) } },
            (response) => {
              response.resume();
              response.once('end', () => resolve(response.statusCode ?? 0));
            },
          );
          request.once('error', reject);
          request.end();
        });
        ingress[path]?.push(status);
      }
    }

    mkdirSync('reports/e2e', { recursive: true });
    writeFileSync('reports/e2e/netlify-ingress.json', JSON.stringify(ingress) + '\n');
    expect(ingress).toEqual({ '/.netlify/functions/me': [200, 401], '/edge/me': [200, 401] });
  } finally {
    try {
      await app?.close();
    } finally {
      await transport.close();
    }
  }
}, 30_000);

// Separate actual CLI processes prove invalid-token refusal and cold key outage in both runtimes.
it('rejects invalid credentials and unavailable keys through actual Netlify Functions v2 and Deno Edge', async () => {
  using config = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-netlify-hostile-'));
  const issuer = inject('e2eUrls').hostile;
  const key = fixtureKey(2048);
  const mint = async (aud: string): Promise<string> =>
    mintToken({
      key,
      header: {},
      payload: {
        iss: issuer,
        aud,
        sub: 'netlify-private',
        exp: Math.floor(Date.now() / 1000) + 300,
      },
    });
  const valid = await mint('https://resource.example');
  const invalid = await mint('private-hostile-audience');
  for (const outage of [false, true]) {
    const app = await spawnNetlify(
      issuer,
      [valid, invalid],
      config.path,
      issuer + (outage ? '/outage' : '/jwks'),
    );
    try {
      for (const path of ['/.netlify/functions/me', '/edge/me']) {
        const response = await fetch(app.url + path, {
          headers: { authorization: 'Bearer ' + (outage ? valid : invalid) },
        });
        expect(response.status).toBe(outage ? 503 : 401);
        expect(response.headers.get('retry-after')).toBe(outage ? '1' : null);
        expect(await response.text()).not.toContain('private-hostile-audience');
      }
    } finally {
      await app.close();
    }
  }
}, 15_000);
