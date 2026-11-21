import { mkdtempDisposableSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';

import { startIssuer } from '../../../../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../../../../packages/testkit/src/keys.ts';
import { mintToken } from '../../../../packages/testkit/src/tokens.ts';
import { spawnAstro } from './runtime.ts';

it('matches native Astro encoded routing and early malformed-URI rejection with same-server JWT recovery', async () => {
  using configuration = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-astro-paths-'));
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
  const app = await spawnAstro(issuer.url, [token], configuration.path, issuer.url + '/jwks');
  const rows: Array<{ readonly path: string; readonly missing: number; readonly valid: number }> =
    [];
  try {
    for (const path of [
      '/api/me',
      '/%61pi/me',
      '/%2561pi/me',
      '/api/me/',
      '/api/caf%C3%A9',
      '//api/me',
    ]) {
      const missing = await fetch(app.url + path);
      const valid = await fetch(app.url + path, { headers: { authorization: 'Bearer ' + token } });
      rows.push({ path, missing: missing.status, valid: valid.status });
      expect(missing.status, path).toBe(401);
      expect(valid.status, path).toBe(200);
      expect(await valid.json()).toMatchObject({ sub: 'path-proof' });
    }

    for (const path of ['/api%2Fme', '/api%3Fme']) {
      const missing = await fetch(app.url + path);
      const valid = await fetch(app.url + path, { headers: { authorization: 'Bearer ' + token } });
      rows.push({ path, missing: missing.status, valid: valid.status });
      expect(missing.status, path).toBe(404);
      expect(valid.status, path).toBe(404);
    }

    // Actual Node/Astro rejects these before middleware. The adapter's exact no-store response is separately retained in its unit regression.
    for (const path of ['/%E0%A4%A', '/%q0']) {
      const missing = await fetch(app.url + path);
      const valid = await fetch(app.url + path, { headers: { authorization: 'Bearer ' + token } });
      rows.push({ path, missing: missing.status, valid: valid.status });
      expect(missing.status, path).toBe(400);
      expect(valid.status, path).toBe(400);
      expect(await missing.text()).toBe('Bad request.');
      expect(await valid.text()).toBe('Bad request.');
      expect(missing.headers.get('cache-control')).toBeNull();
    }

    const following = await fetch(app.url + '/api/me', {
      headers: { authorization: 'Bearer ' + token },
    });
    expect(following.status).toBe(200);
    expect(await following.json()).toMatchObject({ sub: 'path-proof' });
  } finally {
    writeFileSync('reports/e2e/astro-paths.json', JSON.stringify(rows, null, 2) + '\n');
    await app.close();
  }
}, 15_000);
