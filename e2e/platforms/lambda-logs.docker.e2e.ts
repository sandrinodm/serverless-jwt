import { mkdtempDisposableSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

import { fixtureKey } from '../../packages/testkit/src/keys.ts';
import { mintToken } from '../../packages/testkit/src/tokens.ts';
import { privateNetwork } from '../harness/src/docker.ts';
import { startFloci } from '../harness/src/floci.docker.ts';
import { startSam } from '../harness/src/sam.docker.ts';
import { startFaultProxy } from '../harness/src/toxiproxy.docker.ts';

describe.skipIf(!process.env.E2E_DOCKER)('real Lambda log privacy positive controls', () => {
  for (const host of ['sam', 'floci'] as const) {
    // The intentionally leaking fixture is isolated from normal apps and expected to fail teardown.
    it(
      'detects a deliberately token-logging Lambda handler on ' + host,
      async () => {
        using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-lambda-logs-'));
        const network = await privateNetwork();
        const tokens: string[] = [];
        let proxy: Awaited<ReturnType<typeof startFaultProxy>> | undefined;
        let app: { readonly close: () => Promise<void> } | undefined;
        try {
          proxy = await startFaultProxy(tokens, network);
          const token = await mintToken({
            key: fixtureKey(2048),
            header: {},
            payload: {
              iss: proxy.issuer,
              aud: 'https://resource.example',
              sub: 'private-lambda-log-control',
              exp: Math.floor(Date.now() / 1000) + 300,
            },
          });
          tokens.push(token);
          let url: string;
          if (host === 'sam') {
            const sam = await startSam({
              directory: directory.path,
              issuer: proxy.issuer,
              caFile: proxy.caFile,
              network: network.getName(),
              tokens,
              logControl: true,
              logCapture: 'fingerprints',
            });
            app = sam;
            url = sam.url + '/rest';
          } else {
            const floci = await startFloci({
              directory: directory.path,
              issuer: proxy.issuer,
              caFile: proxy.caFile,
              network,
              tokens,
              logControl: true,
              logCapture: 'fingerprints',
            });
            app = floci;
            url = floci.restURL + '/protected';
          }

          const response = await fetch(url, {
            headers: { authorization: 'Bearer ' + token, 'x-e2e-log-control': '1' },
          });
          expect(response.status).toBe(200);
          await response.arrayBuffer();
          const closing = app.close();
          app = undefined;
          await expect(closing).rejects.toThrow('Server log contains a credential');
          const logs = readdirSync('reports/e2e')
            .filter((file) => file.endsWith('.log'))
            .map((file) => readFileSync(join('reports/e2e', file), 'utf8'));
          expect(logs.every((log) => !log.includes(token))).toBe(true);
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
      },
      180_000,
    );
  }
});
