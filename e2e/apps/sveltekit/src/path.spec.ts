import { mkdtempDisposableSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';

import { startIssuer } from '../../../../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../../../../packages/testkit/src/keys.ts';
import { mintToken } from '../../../../packages/testkit/src/tokens.ts';
import { spawnSvelteKit } from './runtime.ts';

it('matches actual Kit routing for encoded, Unicode, reserved, malformed and trailing-slash paths', async () => {
  using configuration = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-sveltekit-paths-'));
  const key = fixtureKey(2048);
  await using issuer = await startIssuer({ script: () => ({ json: { keys: [key.jwk] } }) });
  const token = await mintToken({
    key,
    header: {},
    payload: {
      iss: issuer.url,
      aud: 'https://resource.example',
      sub: 'path-proof',
      exp: Math.floor(Date.now() / 1000) + 300,
    },
  });
  const app = await spawnSvelteKit(issuer.url, [token], configuration.path, issuer.url + '/jwks');
  const rows: Array<{ readonly path: string; readonly missing: number; readonly valid: number }> =
    [];
  try {
    for (const path of ['/api/me', '/%61pi/me', '/api/me/', '/api/caf%C3%A9', '/%61pi/caf%C3%A9']) {
      const missing = await fetch(app.url + path);
      const valid = await fetch(app.url + path, { headers: { authorization: 'Bearer ' + token } });
      rows.push({ path, missing: missing.status, valid: valid.status });
      expect(missing.status, path).toBe(401);
      expect(valid.status).toBe(200);
      expect(await valid.json()).toMatchObject({ sub: 'path-proof' });
    }

    for (const [path, status] of [
      ['//api/me', 404],
      ['/%2561pi/me', 404],
      ['/api%2Fme', 404],
      ['/api%3Fme', 404],
      ['/%E0%A4%A', 400],
      ['/%q0', 400],
    ] as const) {
      const missing = await fetch(app.url + path);
      const valid = await fetch(app.url + path, { headers: { authorization: 'Bearer ' + token } });
      rows.push({ path, missing: missing.status, valid: valid.status });
      expect(missing.status).toBe(status);
      expect(valid.status).toBe(status);
      if (status === 400) {
        const body = await missing.text();
        if (
          body !== 'Invalid request pathname.' ||
          missing.headers.get('cache-control') !== 'no-store'
        ) {
          throw new Error('Malformed path did not return its exact safe response');
        }
      }
    }

    const following = await fetch(app.url + '/api/me', {
      headers: { authorization: 'Bearer ' + token },
    });
    expect(following.status).toBe(200);
    expect(await following.json()).toMatchObject({ sub: 'path-proof' });
    writeFileSync('reports/e2e/sveltekit-paths.json', JSON.stringify(rows, null, 2) + '\n');
  } finally {
    writeFileSync('reports/e2e/sveltekit-paths.json', JSON.stringify(rows, null, 2) + '\n');
    await app.close();
  }
}, 15_000);
