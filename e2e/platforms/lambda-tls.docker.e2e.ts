import { mkdtempDisposableSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

import { fixtureKey } from '../../packages/testkit/src/keys.ts';
import { mintToken } from '../../packages/testkit/src/tokens.ts';
import { privateNetwork } from '../harness/src/docker.ts';
import { startFloci } from '../harness/src/floci.docker.ts';
import { startSam } from '../harness/src/sam.docker.ts';
import { startFaultProxy } from '../harness/src/toxiproxy.docker.ts';

describe.skipIf(!process.env.E2E_DOCKER)('actual Lambda default TLS trust', () => {
  for (const host of ['sam', 'floci'] as const) {
    // Real runtime images receive no test-CA trust; valid signatures cannot bypass TLS validation.
    it(
      'rejects the untrusted issuer CA through actual ' + host + ' REST and HTTP APIs',
      async () => {
        using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-lambda-untrusted-'));
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
              sub: 'untrusted-lambda-subject',
              exp: Math.floor(Date.now() / 1000) + 300,
            },
          });
          tokens.push(token);
          let urls: ReadonlyArray<string>;
          if (host === 'sam') {
            const sam = await startSam({
              directory: directory.path,
              issuer: proxy.issuer,
              caFile: proxy.caFile,
              network: network.getName(),
              tokens,
              trustCA: false,
            });
            app = sam;
            urls = [sam.url + '/rest', sam.url + '/http'];
          } else {
            const floci = await startFloci({
              directory: directory.path,
              issuer: proxy.issuer,
              caFile: proxy.caFile,
              network,
              tokens,
              trustCA: false,
            });
            app = floci;
            urls = [floci.restURL + '/protected', floci.httpURL + '/protected'];
          }

          for (const url of urls) {
            const response = await fetch(url, { headers: { authorization: 'Bearer ' + token } });
            expect(response.status).toBe(503);
            expect(response.headers.get('retry-after')).toBe('1');
            expect(response.headers.get('cache-control')).toBe('no-store');
            expect((await response.text()).includes(token)).toBe(false);
          }

          expect(proxy.counts().requests).toBe(0);
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
