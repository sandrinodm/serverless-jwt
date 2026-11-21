import { mkdtempDisposableSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';

import { startIssuer } from '../../../../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../../../../packages/testkit/src/keys.ts';
import { mintToken } from '../../../../packages/testkit/src/tokens.ts';
import { spawnVercel } from './runtime.ts';

// Actual local Vercel runtime supplies context and exposes its independently measured ingress gap.
it('runs account-free Vercel dev --local with real JWTs, native context and duplicate ingress controls', async () => {
  using config = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-vercel-dev-'));
  const key = fixtureKey(2048);
  await using issuer = await startIssuer({ script: () => ({ json: { keys: [key.jwk] } }) });
  const token = await mintToken({
    key,
    header: {},
    payload: {
      iss: issuer.url,
      aud: 'https://resource.example',
      sub: 'vercel-dev',
      exp: Math.floor(Date.now() / 1000) + 300,
    },
  });
  const app = await spawnVercel(issuer.url, [token], config.path, issuer.url + '/jwks', true);
  try {
    const response = await fetch(app.url + '/api/me', {
      headers: { authorization: 'Bearer ' + token },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sub: 'vercel-dev', context: 'present' });
    const forged = await fetch(app.url + '/api/me', {
      method: 'OPTIONS',
      headers: { 'access-control-request-method': 'GET' },
    });
    expect(forged.status).toBe(401);
    const comma = await fetch(app.url + '/api/me', {
      headers: { authorization: 'Bearer ' + token + ', Bearer invalid' },
    });
    expect(comma.status).toBe(400);
    const statuses: number[] = [];
    for (const values of [
      [token, 'invalid'],
      ['invalid', token],
    ]) {
      statuses.push(
        await new Promise<number>((resolve, reject) => {
          const request = httpRequest(
            app.url + '/api/me',
            { headers: { Authorization: values.map((value) => 'Bearer ' + value) } },
            (reply) => {
              reply.resume();
              reply.once('end', () => resolve(reply.statusCode ?? 0));
            },
          );
          request.once('error', reject);
          request.end();
        }),
      );
    }

    expect(statuses).toEqual([200, 401]);
    const query = await fetch(app.url + '/api/me?access_token=' + encodeURIComponent(token));
    expect(query.status).toBe(401);
    await query.arrayBuffer();
  } finally {
    await app.close();
  }
}, 15_000);
