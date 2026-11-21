import { mkdtempDisposableSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';

import { startIssuer } from '../../../../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../../../../packages/testkit/src/keys.ts';
import { mintToken } from '../../../../packages/testkit/src/tokens.ts';
import { spawnNetlify } from './runtime.ts';

// Actual local Vercel runtime supplies context and exposes its independently measured ingress gap.
it('runs account-free Netlify dev --offline with real JWTs, native context and duplicate ingress controls', async () => {
  using config = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-netlify-dev-'));
  const key = fixtureKey(2048);
  await using issuer = await startIssuer({ script: () => ({ json: { keys: [key.jwk] } }) });
  const token = await mintToken({
    key,
    header: {},
    payload: {
      iss: issuer.url,
      aud: 'https://resource.example',
      sub: 'netlify-dev',
      exp: Math.floor(Date.now() / 1000) + 300,
    },
  });
  const app = await spawnNetlify(issuer.url, [token], config.path, issuer.url + '/jwks');
  try {
    for (const path of ['/.netlify/functions/me', '/edge/me']) {
      const response = await fetch(app.url + path, {
        headers: { authorization: 'Bearer ' + token },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        sub: 'netlify-dev',
        context: true,
        request: true,
      });
      const forged = await fetch(app.url + path, {
        method: 'OPTIONS',
        headers: { 'access-control-request-method': 'GET' },
      });
      expect(forged.status).toBe(401);
      const comma = await fetch(app.url + path, {
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
              app.url + path,
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
    }
  } finally {
    await app.close();
  }
}, 15_000);
