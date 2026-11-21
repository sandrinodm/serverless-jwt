import { mkdtempDisposableSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';

import { privateNetwork } from '../harness/src/docker.ts';
import { startSam } from '../harness/src/sam.docker.ts';
import { startFaultProxy } from '../harness/src/toxiproxy.docker.ts';
import { capabilityMatrix } from '../matrix.ts';
import { lambdaCredentials, lambdaSecurity } from '../suites/lambda.ts';

describe.skipIf(!process.env.E2E_DOCKER)('actual SAM Lambda security matrix', () => {
  let directory: ReturnType<typeof mkdtempDisposableSync>;
  let network: Awaited<ReturnType<typeof privateNetwork>> | undefined;
  let proxy: Awaited<ReturnType<typeof startFaultProxy>> | undefined;
  let app: Awaited<ReturnType<typeof startSam>> | undefined;
  let credentials: Awaited<ReturnType<typeof lambdaCredentials>>;
  // Two real warm Lambda containers start from the pinned eligible image before protected requests.
  beforeAll(async () => {
    directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-sam-security-'));
    network = await privateNetwork();
    const registry: string[] = [];
    proxy = await startFaultProxy(registry, network);
    credentials = await lambdaCredentials(proxy.issuer);
    registry.push(...credentials.tokens);
    app = await startSam({
      directory: directory.path,
      issuer: proxy.issuer,
      caFile: proxy.caFile,
      network: network.getName(),
      tokens: credentials.tokens,
      logCapture: 'fingerprints',
    });
  }, 120_000);
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      try {
        await proxy?.close();
      } finally {
        try {
          await network?.stop();
        } finally {
          directory?.[Symbol.dispose]();
        }
      }
    }
  }, 30_000);
  for (const shape of ['v1', 'v2'] as const) {
    // Two200-concurrent HTTP rounds, real clocks and one-second cooldown/backoff recovery per form.
    it(
      'capability: aws-lambda-sam-' + shape,
      async () => {
        expect(app?.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
        if (!app || !proxy) {
          throw new Error('SAM fixture did not start');
        }

        const row = capabilityMatrix.find((entry) => entry.id === 'aws-lambda-sam-' + shape);
        if (!row) {
          throw new Error('Missing independent SAM capability registration');
        }

        await lambdaSecurity({
          row,
          baseURL: app.url,
          credentials,
          proxy,
          shape,
        });
      },
      180_000,
    );
  }
});
