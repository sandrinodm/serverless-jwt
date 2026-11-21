import { mkdtempDisposableSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

import { privateNetwork } from '../harness/src/docker.ts';
import { startFloci } from '../harness/src/floci.docker.ts';
import { startFaultProxy } from '../harness/src/toxiproxy.docker.ts';

describe.skipIf(!process.env.E2E_DOCKER || process.env.E2E_FLOCI_DIAGNOSTIC !== '1')(
  'bounded native Floci200 infrastructure classification',
  () => {
    // One cold200 control intentionally omits authentication; it is never counted as a JWT capability row.
    it('distinguishes native startup failures from JWT adapter behavior with unchanged cold concurrency', async () => {
      const mem = Number(
        /^MemAvailable:\s+(\d+)/m.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1],
      );
      expect(mem).toBeGreaterThan(30 * 1024 * 1024);
      using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-floci-native200-'));
      const network = await privateNetwork();
      const tokens: string[] = [];
      let proxy: Awaited<ReturnType<typeof startFaultProxy>> | undefined;
      let app: Awaited<ReturnType<typeof startFloci>> | undefined;
      const abort = new AbortController();
      let minimumAvailable = mem;
      const watchdog = setInterval(() => {
        minimumAvailable = Math.min(
          minimumAvailable,
          Number(/^MemAvailable:\s+(\d+)/m.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1]),
        );
        if (minimumAvailable < 8 * 1024 * 1024) {
          abort.abort(new Error('Native control memory safety reserve reached'));
        }
      }, 250);
      try {
        proxy = await startFaultProxy(tokens, network);
        app = await startFloci({
          directory: directory.path,
          issuer: proxy.issuer,
          caFile: proxy.caFile,
          network,
          tokens,
          concurrency: 200,
          nativeControl: true,
          logCapture: 'fingerprints',
        });
        const url = app.restURL + '/protected';
        const results = await Promise.all(
          Array.from({ length: 200 }, async (_, index) => {
            const response = await fetch(url, {
              headers: { 'x-capacity-sub': 'native-' + index },
              signal: AbortSignal.any([abort.signal, AbortSignal.timeout(120_000)]),
            });
            const body = (await response.json().catch(() => ({}))) as { readonly sub?: string };
            return { status: response.status, ownSubject: body.sub === 'native-' + index };
          }),
        );
        const statuses: Record<string, number> = {};
        for (const result of results) {
          statuses[result.status] = (statuses[result.status] ?? 0) + 1;
        }

        writeFileSync(
          'reports/e2e/floci-native200-control.json',
          JSON.stringify(
            {
              requests: results.length,
              statuses,
              ownSubjects: results.filter((result) => result.ownSubject).length,
              minimumAvailable,
              authenticationInvoked: false,
            },
            null,
            2,
          ),
        );
        expect(results.length).toBe(200);
        expect(proxy.counts().requests).toBe(0);
      } finally {
        clearInterval(watchdog);
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
    }, 300_000);
  },
);
