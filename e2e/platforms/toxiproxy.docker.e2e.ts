import { describe, expect, it } from 'vite-plus/test';

import { fixtureKey } from '../../packages/testkit/src/keys.ts';
import { mintToken } from '../../packages/testkit/src/tokens.ts';
import { spawnExample } from '../harness/src/spawn.ts';
import { startFaultProxy } from '../harness/src/toxiproxy.docker.ts';

describe.skipIf(!process.env.E2E_DOCKER)('real HTTPS Toxiproxy routing', () => {
  // Real TCP faults cross one-second fetch deadlines and failure backoff without restarting the app.
  it('counts every discovery/JWKS connection and recovers from reset, latency, timeout and bandwidth faults', async () => {
    const tokens: string[] = [];
    const proxy = await startFaultProxy(tokens);
    let app: Awaited<ReturnType<typeof spawnExample>> | undefined;
    try {
      const token = await mintToken({
        key: fixtureKey(2048),
        header: {},
        payload: {
          iss: proxy.issuer,
          aud: 'https://resource.example',
          sub: 'proxied-subject',
          exp: Math.floor(Date.now() / 1000) + 300,
        },
      });
      tokens.push(token);
      /**
       * Drains each response, exposing only its public status to assertion diagnostics.
       */
      const status = async (): Promise<number> => {
        const response = await fetch(app?.url + '/protected', {
          headers: { authorization: 'Bearer ' + token },
        });
        if (response.status === 503) {
          expect(response.headers.get('retry-after')).toBe('1');
        }

        await response.arrayBuffer();
        return response.status;
      };
      app = await spawnExample(proxy.issuer, tokens, undefined, { keys: { timeout: 1 } });
      const responses = await Promise.all(Array.from({ length: 50 }, status));
      expect(responses).toEqual(Array(50).fill(200));
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(proxy.counts()).toEqual({ requests: 2, connections: 2 });
      const reset = await proxy.toxic('reset_peer', { timeout: 0 });
      expect(await status()).toBe(200); // Fresh known cached key: no upstream traffic.
      expect(proxy.counts().requests).toBe(2);
      await reset();
      await app.close();
      app = undefined;
      for (const [type, attributes] of [
        ['reset_peer', { timeout: 0 }],
        ['latency', { latency: 1500, jitter: 0 }],
        ['timeout', { timeout: 1500 }],
        ['bandwidth', { rate: 1 }],
      ] as const) {
        const before = proxy.counts();
        proxy.padding(type === 'bandwidth' ? 8192 : 0);
        const remove = await proxy.toxic(type, attributes);
        app = await spawnExample(proxy.issuer, tokens, undefined, { keys: { timeout: 1 } });
        try {
          expect(await status(), type).toBe(503);
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
          expect(proxy.counts(), type + ' interrupts TLS before HTTP').toEqual({
            requests: before.requests,
            connections: before.connections + 1,
          }); // Cold cache, no stale key and no previous backoff.
        } finally {
          await remove();
          proxy.padding(0);
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 1_150));
        expect(await status()).toBe(200); // Same verifier recovers when the actual TCP fault is removed.
        await app.close();
        app = undefined;
      }

      const removeSlicer = await proxy.toxic('slicer', {
        average_size: 32,
        size_variation: 0,
        delay: 100,
      });
      app = await spawnExample(proxy.issuer, tokens, undefined, { keys: { timeout: 2 } });
      try {
        expect(await status()).toBe(200);
      } finally {
        await removeSlicer();
      }

      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      // Two initial requests, two per recovery, two sliced, and exactly four failed TLS connections.
      expect(proxy.counts()).toEqual({ requests: 12, connections: 16 });
    } finally {
      try {
        await app?.close();
      } finally {
        await proxy.close();
      }
    }
  }, 60_000);
});
