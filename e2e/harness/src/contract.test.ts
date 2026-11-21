import { decodeJwt } from 'jose';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { afterAll, describe, expect, inject, it } from 'vite-plus/test';

import { issuerTransport } from '../../../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../../../packages/testkit/src/keys.ts';
import { mintToken } from '../../../packages/testkit/src/tokens.ts';
import { redactLogs, spawnExample } from './spawn.ts';

declare module 'vite-plus/test' {
  interface ProvidedContext {
    e2eUrls: { readonly oidc: string; readonly hostile: string };
  }
}

describe('Docker-free real HTTP reference contract', () => {
  const completed = new Set<string>();
  afterAll(() => {
    assert.deepEqual(
      [...completed].sort(),
      ['hostile', 'oidc', 'redaction'],
      'Every PR contract group must execute',
    );
  });
  // This case mints 200 real HTTPS OIDC grants and starts two child processes.
  it('verifies real oidc-provider client-credentials JWTs, missing credentials and 200 distinct clients', async () => {
    const issuer = { url: inject('e2eUrls').oidc };
    const transport = issuerTransport();
    const tokens: string[] = [];
    let app: Awaited<ReturnType<typeof spawnExample>> | undefined;
    try {
      const mint = async (index: number): Promise<string> => {
        const response = await transport.fetch(issuer.url + '/token', {
          method: 'POST',
          headers: {
            authorization:
              'Basic ' + Buffer.from(`client-${index}:synthetic-test-secret`).toString('base64'),
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: 'grant_type=client_credentials&scope=read%20write&resource=https%3A%2F%2Fresource.example',
        });
        expect(response.status).toBe(200);
        const token = ((await response.json()) as { access_token: string }).access_token;
        expect(token.split('.')).toHaveLength(3);
        tokens.push(token);
        return token;
      };
      const token = await mint(0);
      app = await spawnExample(issuer.url, tokens);
      const missing = await fetch(app.url + '/protected');
      expect(missing.status).toBe(401);
      expect(missing.headers.get('cache-control')).toBe('no-store');
      expect(missing.headers.get('www-authenticate')).toBe('Bearer realm="api"');
      const valid = await fetch(app.url + '/protected', {
        headers: { authorization: 'Bearer ' + token },
      });
      expect(valid.status).toBe(200);
      expect(await valid.json()).toMatchObject({ sub: 'client-0', scopes: ['read', 'write'] });
      await app.close();
      app = undefined;
      const credentials = await Promise.all(Array.from({ length: 200 }, (_, index) => mint(index)));
      app = await spawnExample(issuer.url, tokens);
      for (let round = 0; round < 2; round++) {
        const responses = await Promise.all(
          credentials.map(async (credential) => {
            const response = await fetch(app?.url + '/protected', {
              headers: { authorization: 'Bearer ' + credential },
            });
            expect(response.status).toBe(200);
            return response.json();
          }),
        );
        responses.forEach((body, index) => expect(body).toMatchObject({ sub: `client-${index}` }));
      }

      completed.add('oidc');
    } finally {
      try {
        await app?.close();
      } finally {
        await transport.close();
      }
    }
  }, 30_000);
  // This case starts two child processes and exercises separate HTTPS outage and token paths.
  it('uses the hostile HTTPS issuer for invalid tokens, outages, real duplicate Node lines and forged preflights', async () => {
    const key = fixtureKey(2048);
    const issuer = { url: inject('e2eUrls').hostile };
    const tokens: string[] = [];
    const token = await mintToken({
      header: {},
      payload: {
        iss: issuer.url,
        aud: 'https://resource.example',
        sub: 'private-sub',
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      key,
    });
    tokens.push(token);
    const app = await spawnExample(issuer.url, tokens, issuer.url + '/jwks');
    try {
      const forged = await fetch(app.url + '/protected', {
        method: 'OPTIONS',
        headers: { 'access-control-request-method': 'GET' },
      });
      expect(forged.status).toBe(401);
      for (const values of [
        [token, 'invalid'],
        ['invalid', token],
      ]) {
        const status = await new Promise<number>((resolve, reject) => {
          const request = httpRequest(
            app.url + '/protected',
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

      const invalid = await mintToken({
        header: {},
        payload: { ...decodeJwt(token), aud: 'private-hostile-audience' },
        key,
      });
      tokens.push(invalid);
      const response = await fetch(app.url + '/protected', {
        headers: { authorization: 'Bearer ' + invalid },
      });
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain('private-hostile-audience');
    } finally {
      await app.close();
    }

    const cold = await spawnExample(issuer.url, tokens, issuer.url + '/outage');
    try {
      const response = await fetch(cold.url + '/protected', {
        headers: { authorization: 'Bearer ' + token },
      });
      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('1');
    } finally {
      await cold.close();
    }

    completed.add('hostile');
  }, 15_000);
  it('redacts known tokens and JWTs across captured chunk boundaries without returning secrets', () => {
    const secret = 'header123.payload123.signature';
    const result = redactLogs('prefix ' + secret + ' opaque-secret suffix', [
      'opaque-secret',
      secret,
    ]);
    expect(result.leaked).toBe(true);
    expect(result.text).not.toContain(secret);
    expect(result.text).not.toContain('opaque-secret');
    expect(redactLogs('safe startup', [])).toEqual({ text: 'safe startup', leaked: false });
    completed.add('redaction');
  });
});
