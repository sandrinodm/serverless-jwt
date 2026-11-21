import { mkdtempDisposableSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';

import { startIssuer } from '../../../../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../../../../packages/testkit/src/keys.ts';
import { mintToken } from '../../../../packages/testkit/src/tokens.ts';
import { spawnNext } from './runtime.ts';

// Turbopack compiles a real development app and reaches the separately verified HTTPS fixture.
it('runs Next dev Turbopack with real proxy and route authentication', async () => {
  using config = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-next-dev-'));
  const key = fixtureKey(2048);
  await using issuer = await startIssuer({ script: () => ({ json: { keys: [key.jwk] } }) });
  const token = await mintToken({
    key,
    header: {},
    payload: {
      iss: issuer.url,
      aud: 'https://resource.example',
      sub: 'next-dev',
      exp: Math.floor(Date.now() / 1000) + 300,
    },
  });
  const app = await spawnNext(issuer.url, [token], config.path, issuer.url + '/jwks', true);
  try {
    const response = await fetch(app.url + '/api/me/development', {
      headers: { authorization: 'Bearer ' + token },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sub: 'next-dev', id: 'development' });
    const query = await fetch(
      app.url + '/api/me/development?access_token=' + encodeURIComponent(token),
    );
    expect(query.status).toBe(401);
    await query.arrayBuffer();
  } finally {
    await app.close();
  }
}, 15_000);
