import { mkdtempDisposableSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, inject, it } from 'vite-plus/test';

import { fixtureKey } from '../../../packages/testkit/src/keys.ts';
import { mintToken } from '../../../packages/testkit/src/tokens.ts';
import { spawnReactRouter } from '../../apps/react-router/app/runtime.ts';

// The actual patched native CLI runs an intentionally token-logging application handler.
it('keeps Router application stdout guarded after removing only its fixed native access logger', async () => {
  using config = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-router-log-control-'));
  const issuer = inject('e2eUrls').hostile;
  const token = await mintToken({
    key: fixtureKey(2048),
    header: {},
    payload: {
      iss: issuer,
      aud: 'https://resource.example',
      sub: 'private-log-control',
      exp: Math.floor(Date.now() / 1000) + 300,
    },
  });
  const app = await spawnReactRouter(issuer, [token], config.path, issuer + '/jwks', token);
  try {
    const response = await fetch(app.url + '/api/me', {
      headers: { authorization: 'Bearer ' + token },
    });
    expect(response.status).toBe(200);
    await response.arrayBuffer();
  } finally {
    await expect(app.close()).rejects.toThrow('Server log contains a credential');
  }

  expect(readFileSync(app.logFile, 'utf8').includes(token)).toBe(false);
  expect(readFileSync(app.logFile, 'utf8')).toMatch(/\[token:[a-f0-9]{12}\]/u);
}, 10_000);
