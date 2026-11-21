import { mkdtempDisposableSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';

import { startIssuer } from '../../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../../packages/testkit/src/keys.ts';
import { mintToken } from '../../packages/testkit/src/tokens.ts';
import { cloudflareApp } from '../harness/src/cloudflare.ts';

// Two simultaneously live workerd isolates must fetch their own keys, never a process-global store.
it('retains independent key stores in two actual Workers instances', async () => {
  using first = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-worker-first-'));
  using second = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-worker-second-'));
  const key = fixtureKey(2048);
  await using issuer = await startIssuer({ script: () => ({ json: { keys: [key.jwk] } }) });
  const token = await mintToken({
    key,
    header: {},
    payload: {
      iss: issuer.url,
      aud: 'https://resource.example',
      sub: 'isolate',
      exp: Math.floor(Date.now() / 1000) + 300,
    },
  });
  const one = await cloudflareApp('workers', issuer.url, [token], first.path, issuer.url + '/jwks');
  let two: Awaited<ReturnType<typeof cloudflareApp>> | undefined;
  try {
    two = await cloudflareApp('workers', issuer.url, [token], second.path, issuer.url + '/jwks');
    for (const [index, app] of [one, two].entries()) {
      const response = await fetch(app.url + '/protected', {
        headers: { authorization: 'Bearer ' + token },
      });
      expect(response.status).toBe(200);
      await response.arrayBuffer();
      expect(issuer.hits['/jwks']).toBe(index + 1);
    }
  } finally {
    try {
      await two?.close();
    } finally {
      await one.close();
    }
  }
}, 20_000);
