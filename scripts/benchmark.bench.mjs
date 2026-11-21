import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { test } from 'vite-plus/test';

import { createJwtVerifier } from '../packages/jwt-verifier/src/index.ts';
import { signingKey } from '../packages/testkit/src/keys.ts';
import { mintToken } from '../packages/testkit/src/tokens.ts';

const pair = await signingKey('RS256', 'benchmark');
const jwk = pair.jwk;
const token = await mintToken({
  key: pair,
  header: { kid: 'benchmark' },
  payload: {
    iss: 'https://benchmark.test',
    aud: 'api',
    sub: 'benchmark',
    exp: Math.floor(Date.now() / 1000) + 300,
  },
});
const verifier = createJwtVerifier({
  issuer: 'https://benchmark.test',
  audience: 'api',
  jwksUri: 'https://benchmark.test/keys',
  fetch: async () => Response.json({ keys: [jwk] }),
});
await verifier.warmup();

/**
 * Records exactly 10,000 sequential warm-cache verifications, independent of Vitest's clock.
 */
test('10,000 warm-cache RS256 verifications', async ({ bench }) => {
  const times = [];
  await bench('warm-cache RS256', async () => {
    const started = performance.now();
    await verifier.verify(token);
    times.push(performance.now() - started);
  }).run({ iterations: 10_000, time: 0, warmup: false });
  assert.equal(times.length, 10_000);
  times.sort((a, b) => a - b);
  const result = {
    samples: times.length,
    p50Ms: times[4999],
    p99Ms: times[9899],
    node: process.version,
    cpu: cpus()[0].model,
  };
  mkdirSync('reports', { recursive: true });
  writeFileSync('reports/benchmark.json', JSON.stringify(result, null, 2) + '\n');
  const baselineFile = new URL('./benchmark-baseline.json', import.meta.url);
  if (process.env.RECORD_BENCHMARK === '1') {
    writeFileSync(baselineFile, JSON.stringify(result, null, 2) + '\n');
  }

  if (process.env.NIGHTLY) {
    const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
    assert.ok(result.p50Ms <= baseline.p50Ms * 1.2, 'Warm-cache p50 regressed more than 20%');
    assert.ok(result.p99Ms <= baseline.p99Ms * 1.2, 'Warm-cache p99 regressed more than 20%');
  }
});
