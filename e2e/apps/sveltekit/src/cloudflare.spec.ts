import { mkdtempDisposableSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';

import { startIssuer } from '../../../../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../../../../packages/testkit/src/keys.ts';
import { mintToken } from '../../../../packages/testkit/src/tokens.ts';
import { spawnSvelteKitWorker } from './runtime.ts';

it('authenticates actual SvelteKit Cloudflare output on workerd with verified HTTPS and request isolation', async () => {
  using configuration = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-sveltekit-workerd-'));
  const key = fixtureKey(2048);
  await using issuer = await startIssuer({
    script: (path) => (path === '/outage' ? { status: 503 } : { json: { keys: [key.jwk] } }),
  });
  const tokens = await Promise.all(
    Array.from({ length: 200 }, (_, index) =>
      mintToken({
        key,
        header: {},
        payload: {
          iss: issuer.url,
          aud: 'https://resource.example',
          sub: 'worker-' + index,
          exp: Math.floor(Date.now() / 1000) + 300,
        },
      }),
    ),
  );
  const invalid = await mintToken({
    key,
    header: {},
    payload: { iss: issuer.url, aud: 'wrong', exp: Math.floor(Date.now() / 1000) + 300 },
  });
  const app = await spawnSvelteKitWorker(
    issuer.url,
    [...tokens, invalid],
    configuration.path,
    issuer.url + '/jwks',
  );
  try {
    const endpoint = await fetch(app.url + '/endpoint-auth');
    expect(endpoint.status).toBe(401);
    expect(endpoint.headers.get('www-authenticate')).toBe('Bearer realm="api"');
    expect(endpoint.headers.get('cache-control')).toBe('no-store');
    expect((await fetch(app.url + '/api/me')).status).toBe(401);
    expect((await fetch(app.url + '/%61pi/me')).status).toBe(401);
    expect(
      (
        await fetch(app.url + '/api/me', {
          method: 'OPTIONS',
          headers: { 'access-control-request-method': 'GET' },
        })
      ).status,
    ).toBe(401);
    expect(
      (await fetch(app.url + '/api/me', { headers: { authorization: 'Bearer ' + invalid } }))
        .status,
    ).toBe(401);
    for (const values of [
      [tokens[0], 'invalid'],
      ['invalid', tokens[0]],
    ]) {
      const status = await new Promise<number>((resolve, reject) => {
        const request = httpRequest(
          app.url + '/api/me',
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

    const warmed = await fetch(app.url + '/api/me', {
      headers: { authorization: 'Bearer ' + tokens[0] },
    });
    expect(warmed.status).toBe(200);
    for (let round = 0; round < 2; round++) {
      const identities = await Promise.all(
        tokens.map(async (token) => {
          const response = await fetch(app.url + '/api/me', {
            headers: { authorization: 'Bearer ' + token },
          });
          expect(response.status).toBe(200);
          return response.json() as Promise<{ readonly sub: string }>;
        }),
      );
      expect(identities.map((body) => body.sub)).toEqual(
        tokens.map((_, index) => 'worker-' + index),
      );
    }
  } finally {
    await app.close();
  }

  const unavailable = await spawnSvelteKitWorker(
    issuer.url,
    tokens,
    configuration.path,
    issuer.url + '/outage',
  );
  try {
    const response = await fetch(unavailable.url + '/api/me', {
      headers: { authorization: 'Bearer ' + tokens[0] },
    });
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
  } finally {
    await unavailable.close();
  }
}, 15_000);
