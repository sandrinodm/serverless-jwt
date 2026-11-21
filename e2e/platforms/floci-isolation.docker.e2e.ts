import { mkdtempDisposableSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

import { privateNetwork } from '../harness/src/docker.ts';
import { measureFlociCapacity } from '../harness/src/floci-capacity.docker.ts';
import { assertFlociKeyringCapacity } from '../harness/src/floci-keyring.ts';
import { startFloci } from '../harness/src/floci.docker.ts';
import { startFaultProxy } from '../harness/src/toxiproxy.docker.ts';
import { lambdaCredentials } from '../suites/lambda.ts';

/**
 * Reads Linux's immediately available physical memory, excluding swap and optimistic virtual
 * limits.
 */
function availableKiB(): number {
  return Number(/^MemAvailable:\s+(\d+)/m.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1]);
}

describe.skipIf(!process.env.E2E_DOCKER)('actual resource-guarded Floci200 isolation', () => {
  for (const shape of ['v1', 'v2'] as const) {
    // Each form owns its own emulator: at most200 executors exist, never400 across both functions.
    it(
      'capability: aws-lambda-floci-' + shape,
      async () => {
        assertFlociKeyringCapacity();
        // The returned measurement belongs to this case; no report-file prerequisite can race.
        const sample = await measureFlociCapacity();
        // The measured eight-runtime RSS bound is doubled, plus2GiB for the emulator/tooling.
        const requiredKiB = sample.maxRssKiB * 200 * 2 + 2 * 1024 * 1024;
        const measurementAge = Date.now() - Date.parse(sample.measuredAt);
        expect(
          measurementAge,
          'A fresh capacity measurement is required before full200',
        ).toBeGreaterThanOrEqual(0);
        expect(
          measurementAge,
          'A fresh capacity measurement is required before full200',
        ).toBeLessThan(5 * 60_000);
        expect(
          availableKiB(),
          'Full200 requires measured physical capacity; no serial/batched fallback',
        ).toBeGreaterThan(Math.max(requiredKiB, 30 * 1024 * 1024));
        using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-floci-full200-'));
        const network = await privateNetwork();
        const registry: string[] = [];
        let proxy: Awaited<ReturnType<typeof startFaultProxy>> | undefined;
        let app: Awaited<ReturnType<typeof startFloci>> | undefined;
        const abort = new AbortController();
        let minimumAvailable = availableKiB();
        let failedStatus: number | undefined;
        let failedReason = 'none';
        const monitor = setInterval(() => {
          minimumAvailable = Math.min(minimumAvailable, availableKiB());
          if (minimumAvailable < 8 * 1024 * 1024) {
            abort.abort(new Error('Floci full200 physical-memory safety reserve was reached'));
          }
        }, 250);
        try {
          proxy = await startFaultProxy(registry, network);
          const credentials = await lambdaCredentials(proxy.issuer);
          registry.push(...credentials.tokens);
          proxy.sealLogs();
          app = await startFloci({
            directory: directory.path,
            issuer: proxy.issuer,
            caFile: proxy.caFile,
            network,
            tokens: credentials.tokens,
            concurrency: 200,
            logCapture: 'fingerprints',
          });
          const url = (shape === 'v1' ? app.restURL : app.httpURL) + '/protected';
          const rounds: number[] = [];
          for (let round = 0; round < 2; round++) {
            const responses = await Promise.all(
              credentials.credentials.map(async (token) => {
                const response = await fetch(url, {
                  headers: { authorization: 'Bearer ' + token },
                  signal: AbortSignal.any([abort.signal, AbortSignal.timeout(120_000)]),
                });
                if (response.status !== 200) {
                  failedStatus = response.status;
                  const body = (await response.json().catch(() => ({}))) as {
                    readonly error?: unknown;
                  };
                  failedReason =
                    typeof body.error === 'string' &&
                    [
                      'temporarily_unavailable',
                      'invalid_token',
                      'invalid_request',
                      'server_error',
                    ].includes(body.error)
                      ? body.error
                      : 'nonstandard';
                  throw new Error(
                    'Floci ' +
                      shape +
                      ' isolation request returned status ' +
                      response.status +
                      ' (' +
                      failedReason +
                      ')',
                  );
                }

                return response.json() as Promise<{ readonly sub: string }>;
              }),
            );
            expect(
              responses.every((body, index) => body.sub === credentials.subjects[index]),
              'Each concurrent response must echo only its own subject',
            ).toBe(true);
            rounds.push(responses.length);
          }

          app.verifyImages(1, 200);
          const runtimes = app.runtimeStats();
          writeFileSync(
            'reports/e2e/floci-full200-' + shape + '.json',
            JSON.stringify(
              {
                shape,
                rounds,
                requiredKiB,
                minimumAvailable,
                maxThreadsPerSample: sample.maxThreads,
                runtimes,
                completed: new Date().toISOString(),
              },
              null,
              2,
            ),
          );
        } catch (cause) {
          writeFileSync(
            'reports/e2e/floci-full200-failure-' + shape + '.json',
            JSON.stringify(
              {
                shape,
                failedStatus,
                failedReason,
                minimumAvailable,
                error: cause instanceof Error ? cause.name : 'unknown',
              },
              null,
              2,
            ),
          );
          throw cause;
        } finally {
          clearInterval(monitor);
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
      },
      300_000,
    );
  }
});
