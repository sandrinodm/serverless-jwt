import assert from 'node:assert/strict';

import { startIssuer } from '../../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../../packages/testkit/src/keys.ts';
import { mintToken } from '../../packages/testkit/src/tokens.ts';
import { spawnExample } from '../harness/src/spawn.ts';

/**
 * Sleeps only across real policy cooldowns, with broad margins rather than boundary assertions.
 */
async function cooldown(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 1_150));
}

/**
 * Exercises real HTTPS fetches and spawned HTTP guards, specifying each cache and backoff state.
 */
export async function faultSuite(node: string): Promise<void> {
  const key = fixtureKey(2048);
  const rotated = { ...key.jwk, kid: 'rotated-key' };
  await using issuer = await startIssuer({ script: () => ({ json: { keys: [key.jwk] } }) });
  const tokens: string[] = [];
  /**
   * Mints a real signature with a controllable key id without exposing the compact credential.
   */
  const mint = async (kid?: string): Promise<string> => {
    const token = await mintToken({
      key,
      header: kid ? { kid } : {},
      payload: {
        iss: issuer.url,
        aud: 'https://resource.example',
        sub: 'fault-subject',
        exp: Math.floor(Date.now() / 1000) + 300,
      },
    });
    tokens.push(token);
    return token;
  };
  const known = await mint();
  const newKey = await mint('rotated-key');
  const unknown = await Promise.all(
    Array.from({ length: 50 }, (_, index) => mint('unknown-' + index)),
  );
  /**
   * Reads fixed public responses and always drains the body to close each transport cleanly.
   */
  const request = async (
    url: string,
    token: string,
  ): Promise<{ readonly status: number; readonly reason: unknown }> => {
    const response = await fetch(url + '/protected', {
      headers: { authorization: 'Bearer ' + token },
    });
    assert.equal(
      response.headers.get('cache-control'),
      response.status === 200 ? null : 'no-store',
    );
    if (response.status === 503) {
      assert.equal(response.headers.get('retry-after'), '1');
    }

    const body = (await response.json()) as { readonly error?: string };
    return { status: response.status, reason: body.error };
  };
  /**
   * Gives each scenario a new verifier so cache/cooldown/backoff state never leaks between cases.
   */
  const start = (cacheMaxAge = 60, discovery = false): ReturnType<typeof spawnExample> =>
    spawnExample(issuer.url, tokens, discovery ? undefined : issuer.url + '/jwks', {
      node,
      keys: { cacheMaxAge, cooldown: 1, timeout: 1 },
    });
  const cold = await start();
  try {
    issuer.setScript(() => ({ delay: 100, json: { keys: [key.jwk] } }));
    // Cold cache, key present, cooldown/backoff clear: fifty requests share exactly one fetch.
    const before = issuer.hits['/jwks'] ?? 0;
    assert.deepEqual(
      await Promise.all(Array.from({ length: 50 }, () => request(cold.url, known))).then((rows) =>
        rows.map((row) => row.status),
      ),
      Array(50).fill(200),
    );
    assert.equal((issuer.hits['/jwks'] ?? 0) - before, 1);
    issuer.setScript(() => ({ reset: true }));
    // Fresh cached known key must stay available while upstream is down, without any fetch.
    assert.equal((await request(cold.url, known)).status, 200);
    assert.equal((issuer.hits['/jwks'] ?? 0) - before, 1);
    // New key during cooldown: fixed key-not-found 401, zero additional fetches.
    assert.equal((await request(cold.url, newKey)).status, 401);
    assert.equal((issuer.hits['/jwks'] ?? 0) - before, 1);
    await cooldown();
    // Unknown key after cooldown requires I/O: outage is 503, never a stale success.
    assert.equal((await request(cold.url, newKey)).status, 503);
    assert.equal((issuer.hits['/jwks'] ?? 0) - before, 2);
    await cooldown();
    issuer.setScript(() => ({ json: { keys: [rotated, key.jwk] } }));
    // Recovery keeps the process alive; reordered real keys refresh exactly once after backoff.
    assert.equal((await request(cold.url, newKey)).status, 200);
    assert.equal((issuer.hits['/jwks'] ?? 0) - before, 3);
    assert.equal((await request(cold.url, known)).status, 200);
    await cooldown();
    const floodBefore = issuer.hits['/jwks'] ?? 0;
    const flood = await Promise.all(unknown.map((token) => request(cold.url, token)));
    assert.ok(flood.every((row) => row.status === 401));
    assert.equal((issuer.hits['/jwks'] ?? 0) - floodBefore, 1);
  } finally {
    await cold.close();
  }

  for (const attack of [
    'cold-outage',
    'stale-outage',
    'oversized',
    'slow-drip',
    'issuer-mismatch',
  ] as const) {
    issuer.setScript(() => ({ json: { keys: [key.jwk] } }));
    const app = await start(attack === 'stale-outage' ? 1 : 60, attack === 'issuer-mismatch');
    try {
      if (attack === 'stale-outage') {
        assert.equal((await request(app.url, known)).status, 200);
        await cooldown();
      }

      const before = Object.values(issuer.hits).reduce((sum, value) => sum + value, 0);
      issuer.setScript(() =>
        attack === 'oversized'
          ? { megabytes: 2 }
          : attack === 'slow-drip'
            ? { drip: 100, json: { keys: [key.jwk] } }
            : attack === 'issuer-mismatch'
              ? { json: { issuer: 'https://wrong.example', jwks_uri: issuer.url + '/jwks' } }
              : { status: 503 },
      );
      // Fetch needed, staleIfError disabled, no usable backoff state: every attack is 503.
      assert.equal((await request(app.url, known)).status, 503);
      assert.equal(Object.values(issuer.hits).reduce((sum, value) => sum + value, 0) - before, 1);
      await cooldown();
      issuer.setScript((path) => ({
        json: path.includes('.well-known')
          ? { issuer: issuer.url, jwks_uri: issuer.url + '/jwks' }
          : { keys: [key.jwk] },
      }));
      assert.equal((await request(app.url, known)).status, 200);
    } finally {
      await app.close();
    }
  }
}
