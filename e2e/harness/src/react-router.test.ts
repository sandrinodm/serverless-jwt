import { mkdtempDisposableSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, inject, it } from 'vite-plus/test';

import { issuerTransport } from '../../../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../../../packages/testkit/src/keys.ts';
import { mintToken } from '../../../packages/testkit/src/tokens.ts';
import { spawnReactRouter } from '../../apps/react-router/app/runtime.ts';

// Actual React Router resource APIs preserve identities across two distinct 200-client rounds.
it('authenticates actual React Router standalone output with verified HTTPS OIDC and 200 distinct clients', async () => {
  using config = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-react-router-'));
  const issuer = inject('e2eUrls').oidc;
  const transport = issuerTransport();
  const tokens: string[] = [];
  let app: Awaited<ReturnType<typeof spawnReactRouter>> | undefined;
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
    app = await spawnReactRouter(issuer, tokens, config.path);
    const encoded = await fetch(app.url + '/%61pi/me');
    expect(encoded.status).toBe(401);
    const missing = await fetch(app.url + '/api/me');
    expect(missing.status).toBe(401);
    expect(missing.headers.get('cache-control')).toBe('no-store');
    expect(missing.headers.get('www-authenticate')).toBe('Bearer realm="api"');
    const forged = await fetch(app.url + '/api/me', {
      method: 'OPTIONS',
      headers: { 'access-control-request-method': 'GET' },
    });
    expect(forged.status).toBe(401);
    for (const method of ['GET', 'POST', 'OPTIONS']) {
      const response = await fetch(app.url + '/api/me', {
        method,
        headers: { authorization: 'Bearer ' + credentials[0] },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ subject: 'client-0', method });
    }

    const joined = await fetch(app.url + '/api/me', {
      headers: { authorization: 'Bearer ' + credentials[0] + ', Bearer invalid' },
    });
    expect(joined.status).toBe(400);
    for (let round = 0; round < 2; round++) {
      const responses = await Promise.all(
        credentials.map(async (credential) => {
          const response = await fetch(app?.url + '/api/me', {
            headers: { authorization: 'Bearer ' + credential },
          });
          expect(response.status).toBe(200);
          return response.json() as Promise<{ readonly subject: string }>;
        }),
      );
      responses.forEach((body, index) =>
        expect(body).toMatchObject({ subject: 'client-' + index }),
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
      expect(status).toBe(values[0] === credentials[0] ? 200 : 401);
    }
  } finally {
    try {
      await app?.close();
    } finally {
      await transport.close();
    }
  }
}, 30_000);

// Separate production servers prove bad-audience refusal and cold key outage on actual framework output.
it('rejects invalid credentials and unavailable keys through actual React Router standalone output', async () => {
  using config = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-react-router-hostile-'));
  const issuer = inject('e2eUrls').hostile;
  const key = fixtureKey(2048);
  const mint = async (aud: string): Promise<string> =>
    mintToken({
      key,
      header: {},
      payload: {
        iss: issuer,
        aud,
        sub: 'react-router-private',
        exp: Math.floor(Date.now() / 1000) + 300,
      },
    });
  const valid = await mint('https://resource.example');
  const invalid = await mint('private-hostile-audience');
  for (const outage of [false, true]) {
    const app = await spawnReactRouter(
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
