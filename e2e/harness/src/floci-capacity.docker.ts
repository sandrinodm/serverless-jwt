import assert from 'node:assert/strict';
import { mkdtempDisposableSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixtureKey } from '../../../packages/testkit/src/keys.ts';
import { mintToken } from '../../../packages/testkit/src/tokens.ts';
import { privateNetwork } from './docker.ts';
import { startFloci } from './floci.docker.ts';
import { startFaultProxy } from './toxiproxy.docker.ts';

/**
 * Measures this run's own bounded native cold sample before any full200 provisioning starts.
 * Returning the exact in-memory record prevents stale files and parallel writers satisfying
 * safety.
 */
export async function measureFlociCapacity(): Promise<{
  readonly maxRssKiB: number;
  readonly maxThreads: number;
  readonly measuredAt: string;
}> {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-floci-capacity-'));
  const network = await privateNetwork();
  const tokens: string[] = [];
  let proxy: Awaited<ReturnType<typeof startFaultProxy>> | undefined;
  let app: Awaited<ReturnType<typeof startFloci>> | undefined;
  try {
    proxy = await startFaultProxy(tokens, network);
    const issuer = proxy.issuer;
    tokens.push(
      ...(await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          mintToken({
            key: fixtureKey(2048),
            header: {},
            payload: {
              iss: issuer,
              aud: 'https://resource.example',
              sub: 'capacity-' + index,
              exp: Math.floor(Date.now() / 1000) + 300,
            },
          }),
        ),
      )),
    );
    app = await startFloci({
      directory: directory.path,
      issuer,
      caFile: proxy.caFile,
      network,
      tokens,
      concurrency: 8,
      logCapture: 'fingerprints',
    });
    const url = app.restURL + '/protected';
    const responses = await Promise.all(
      tokens.map(async (token) => {
        const response = await fetch(url, { headers: { authorization: 'Bearer ' + token } });
        assert.equal(response.status, 200);
        return response.json() as Promise<{ readonly sub: string }>;
      }),
    );
    assert.deepEqual(
      responses.map((body) => body.sub),
      Array.from({ length: 8 }, (_, index) => 'capacity-' + index),
    );
    const runtimes = app.runtimeStats();
    assert.ok(runtimes.length > 0);
    assert.ok(runtimes.length <= 8);
    const meminfo = readFileSync('/proc/meminfo', 'utf8');
    const maxPssKiB = Math.max(...runtimes.map((runtime) => runtime.pssKiB ?? Number.NaN));
    const availableKiB = Number(/^MemAvailable:\s+(\d+)/m.exec(meminfo)?.[1]);
    const maxRssKiB = Math.max(...runtimes.map((runtime) => runtime.rssKiB));
    const maxThreads = Math.max(...runtimes.map((runtime) => runtime.threads));
    const sample = { maxRssKiB, maxThreads, measuredAt: new Date().toISOString() };
    writeFileSync(
      'reports/e2e/floci-capacity.json',
      JSON.stringify(
        {
          sample: 8,
          runtimes,
          availableKiB,
          maxRssKiB,
          maxPssKiB: Number.isFinite(maxPssKiB) ? maxPssKiB : null,
          maxThreads,
          conservative200RssKiB: maxRssKiB * 200 * 2,
          measuredAt: sample.measuredAt,
        },
        null,
        2,
      ),
    );
    return sample;
  } finally {
    try {
      await app?.close();
    } finally {
      try {
        await proxy?.close();
      } finally {
        await network.stop();
      }
    }
  }
}
