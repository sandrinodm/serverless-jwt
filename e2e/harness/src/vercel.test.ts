import { mkdtempDisposableSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, inject, it } from 'vite-plus/test';

import { issuerTransport } from '../../../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../../../packages/testkit/src/keys.ts';
import { mintToken } from '../../../packages/testkit/src/tokens.ts';
import { spawnVercel } from '../../apps/vercel/src/runtime.ts';

// The real built Web function runs on Node24 with no context argument and two 200-client rounds.
it('authenticates actual Vercel build output with verified HTTPS OIDC and 200 distinct clients', async () => {
  using config = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-vercel-'));
  const issuer = inject('e2eUrls').oidc;
  const transport = issuerTransport();
  const tokens: string[] = [];
  let app: Awaited<ReturnType<typeof spawnVercel>> | undefined;
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
    app = await spawnVercel(issuer, tokens, config.path);
    const missing = await fetch(app.url + '/api/me');
    expect(missing.status).toBe(401);
    expect(missing.headers.get('cache-control')).toBe('no-store');
    expect(missing.headers.get('www-authenticate')).toBe('Bearer realm="api"');
    const forged = await fetch(app.url + '/api/me', {
      method: 'OPTIONS',
      headers: { 'access-control-request-method': 'GET' },
    });
    expect(forged.status).toBe(401);
    for (let round = 0; round < 2; round++) {
      const responses = await Promise.all(
        credentials.map(async (credential) => {
          const response = await fetch(app?.url + '/api/me', {
            headers: { authorization: 'Bearer ' + credential },
          });
          expect(response.status).toBe(200);
          return response.json() as Promise<{ readonly sub: string; readonly context: string }>;
        }),
      );
      responses.forEach((body, index) =>
        expect(body).toMatchObject({ sub: 'client-' + index, context: 'absent' }),
      );
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
}, 30_000);

// Separate native Node processes verify bad-audience refusal and cold key outage on actual output.
it('rejects invalid credentials and unavailable keys through actual Vercel build output', async () => {
  using config = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-vercel-hostile-'));
  const issuer = inject('e2eUrls').hostile;
  const key = fixtureKey(2048);
  const mint = async (aud: string): Promise<string> =>
    mintToken({
      key,
      header: {},
      payload: {
        iss: issuer,
        aud,
        sub: 'vercel-private',
        exp: Math.floor(Date.now() / 1000) + 300,
      },
    });
  const valid = await mint('https://resource.example');
  const invalid = await mint('private-hostile-audience');
  for (const outage of [false, true]) {
    const app = await spawnVercel(
      issuer,
      [valid, invalid],
      config.path,
      issuer + (outage ? '/outage' : '/jwks'),
    );
    try {
      const response = await fetch(app.url + '/api/me', {
        headers: { authorization: 'Bearer ' + (outage ? valid : invalid) },
      });
      expect(response.status).toBe(outage ? 503 : 401);
      expect(response.headers.get('retry-after')).toBe(outage ? '1' : null);
      expect(await response.text()).not.toContain('private-hostile-audience');
    } finally {
      await app.close();
    }
  }
}, 15_000);
