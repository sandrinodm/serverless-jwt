import { mkdtempDisposableSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, inject, it } from 'vite-plus/test';

import { issuerTransport } from '../../../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../../../packages/testkit/src/keys.ts';
import { mintToken } from '../../../packages/testkit/src/tokens.ts';
import { spawnNext } from '../../apps/next/src/runtime.ts';

// The actual production CLI verifies both route-only and proxy+route flows with 200 real grants.
it('runs Next production App Router and proxy with real HTTPS OIDC and 200 distinct clients', async () => {
  using config = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-next-'));
  const transport = issuerTransport();
  const issuer = inject('e2eUrls').oidc;
  const tokens: string[] = [];
  let app: Awaited<ReturnType<typeof spawnNext>> | undefined;
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
    app = await spawnNext(issuer, tokens, config.path);
    const duplicateIngress: Array<{ readonly path: string; readonly statuses: number[] }> = [];
    for (const path of ['/api/me/original', '/direct/me/original']) {
      const missing = await fetch(app.url + path);
      expect(missing.status).toBe(401);
      expect(missing.headers.get('www-authenticate')).toBe('Bearer realm="api"');
      expect(missing.headers.get('cache-control')).toBe('no-store');
      const forged = await fetch(app.url + path, {
        method: 'OPTIONS',
        headers: { 'access-control-request-method': 'GET' },
      });
      expect(forged.status).toBe(401);
      const comma = await fetch(app.url + path, {
        headers: { authorization: 'Bearer ' + credentials[0] + ', Bearer invalid' },
      });
      expect(comma.status).toBe(400);
      for (let round = 0; round < 2; round++) {
        const responses = await Promise.all(
          credentials.map(async (credential) => {
            const response = await fetch(app?.url + path, {
              headers: { authorization: 'Bearer ' + credential, 'x-auth-sub': 'spoofed' },
            });
            expect(response.status).toBe(200);
            return response.json() as Promise<{
              readonly sub: string;
              readonly id: string;
              readonly spoofed: string;
            }>;
          }),
        );
        responses.forEach((body, index) =>
          expect(body).toMatchObject({
            sub: 'client-' + index,
            id: 'original',
            spoofed: 'spoofed',
          }),
        );
      }

      const statuses: number[] = [];
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
        statuses.push(status);
      }

      duplicateIngress.push({ path, statuses });
    }

    // Actual Next Node ingress discards later lines before the adapter receives NextRequest.
    expect(duplicateIngress).toEqual([
      { path: '/api/me/original', statuses: [200, 401] },
      { path: '/direct/me/original', statuses: [200, 401] },
    ]);
  } finally {
    try {
      await app?.close();
    } finally {
      await transport.close();
    }
  }
}, 30_000);

// Separate child processes exercise the actual production invalid-token and unavailable-key paths.
it('rejects invalid tokens and key outages through actual Next production handlers', async () => {
  using config = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-next-hostile-'));
  const issuer = inject('e2eUrls').hostile;
  const tokens: string[] = [];
  const valid = await mintToken({
    key: fixtureKey(2048),
    header: {},
    payload: {
      iss: issuer,
      aud: 'https://resource.example',
      sub: 'next-hostile',
      exp: Math.floor(Date.now() / 1000) + 300,
    },
  });
  const invalid = await mintToken({
    key: fixtureKey(2048),
    header: {},
    payload: {
      iss: issuer,
      aud: 'private-hostile-audience',
      sub: 'next-hostile',
      exp: Math.floor(Date.now() / 1000) + 300,
    },
  });
  tokens.push(valid, invalid);
  for (const outage of [false, true]) {
    const app = await spawnNext(
      issuer,
      tokens,
      config.path,
      issuer + (outage ? '/outage' : '/jwks'),
    );
    try {
      for (const path of ['/api/me/original', '/direct/me/original']) {
        const response = await fetch(app.url + path, {
          headers: { authorization: 'Bearer ' + (outage ? valid : invalid) },
        });
        expect(response.status).toBe(outage ? 503 : 401);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('retry-after')).toBe(outage ? '1' : null);
        expect(await response.text()).not.toContain('private-hostile-audience');
      }
    } finally {
      await app.close();
    }
  }
}, 15_000);
