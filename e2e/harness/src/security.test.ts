import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempDisposableSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, inject, it } from 'vite-plus/test';

import { issuerTransport } from '../../../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../../../packages/testkit/src/keys.ts';
import { mintToken } from '../../../packages/testkit/src/tokens.ts';
import { capabilityMatrix } from '../../matrix.ts';
import { securitySuite } from '../../suites/security.ts';
import { spawnCapability } from './capability.ts';
import { applicationDirectory } from './release.ts';

for (const row of capabilityMatrix.filter(
  (entry) =>
    (entry.project === 'pr' || process.env.E2E_PROJECT === 'nightly') &&
    !entry.id.endsWith('-build') &&
    entry.streaming !== 'preparation-only' &&
    entry.file.endsWith('/security.test.ts') &&
    (!process.env.E2E_INTEGRATION || entry.integration === process.env.E2E_INTEGRATION) &&
    (!process.env.E2E_APPLICATION ||
      (entry.application ?? entry.integration) === process.env.E2E_APPLICATION) &&
    (!process.env.E2E_RUNTIME || entry.host === process.env.E2E_RUNTIME),
)) {
  // One complete real runtime per matrix row; no warmup before its concurrent cold-cache round.
  it(
    'capability: ' + row.id,
    async () => {
      using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-security-'));
      const issuer = inject('e2eUrls').oidc;
      const transport = issuerTransport();
      const tokens: string[] = [];
      let app: { readonly url: string; readonly close: () => Promise<void> } | undefined;
      try {
        const credentials = await Promise.all(
          Array.from({ length: 200 }, async (_, index): Promise<string> => {
            const response = await transport.fetch(issuer + '/token', {
              method: 'POST',
              headers: {
                authorization:
                  'Basic ' +
                  Buffer.from('client-' + index + ':synthetic-test-secret').toString('base64'),
                'content-type': 'application/x-www-form-urlencoded',
              },
              body: 'grant_type=client_credentials&scope=read%20write&resource=https%3A%2F%2Fresource.example',
            });
            if (response.status !== 200) {
              throw new Error('Real issuer grant failed');
            }

            const token = ((await response.json()) as { readonly access_token: string })
              .access_token;
            tokens.push(token);
            return token;
          }),
        );
        app = await spawnCapability(row, issuer, tokens, directory.path);

        if (row.id === 'astro-node' || row.id === 'sveltekit-node') {
          const endpoint = await fetch(app.url + '/endpoint-auth');
          assert.equal(endpoint.status, 401);
          assert.equal(endpoint.headers.get('www-authenticate'), 'Bearer realm="api"');
          assert.equal(endpoint.headers.get('cache-control'), 'no-store');
        }

        expect(app.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
        let route = row.route;
        if (row.rpc) {
          const response = await fetch(app.url + '/rpc-info', {
            signal: AbortSignal.timeout(10_000),
          });
          assert.equal(response.status, 200);
          route = ((await response.json()) as { readonly url: string }).url;
          assert.match(route, /^\/_serverFn\//u);
        }

        await securitySuite({
          row: { ...row, route },
          ...(row.rpc ? { headers: { 'x-tsr-serverFn': 'true', origin: app.url } } : {}),
          url: app.url,
          tokens: credentials,
          subjects: Array.from({ length: 200 }, (_, index) => 'client-' + index),
        });
        // Real-clock checks use wide margins; every form gets its own fresh hostile-issuer guard.
        await app.close();
        app = undefined;
        const hostile = inject('e2eUrls').hostile;
        const key = fixtureKey(2048);
        const now = Math.floor(Date.now() / 1000);
        const timed = await Promise.all(
          [now + 300, now - 3600].map((exp) =>
            mintToken({
              key,
              header: {},
              payload: { iss: hostile, aud: 'https://resource.example', sub: 'time-smoke', exp },
            }),
          ),
        );
        tokens.push(...timed);
        app = await spawnCapability(row, hostile, tokens, directory.path, hostile + '/jwks');
        if (row.rpc) {
          const response = await fetch(app.url + '/rpc-info', {
            signal: AbortSignal.timeout(10_000),
          });
          assert.equal(response.status, 200);
          route = ((await response.json()) as { readonly url: string }).url;
        }

        for (const [index, token] of timed.entries()) {
          const response = await fetch(app.url + route, {
            signal: AbortSignal.timeout(10_000),
            headers: {
              ...(row.rpc ? { 'x-tsr-serverFn': 'true', origin: app.url } : {}),
              authorization: 'Bearer ' + token,
            },
          });
          assert.equal(response.status, index === 0 ? 200 : 401);
          await response.arrayBuffer();
        }
      } finally {
        try {
          await app?.close();
        } finally {
          await transport.close();
        }
      }
    },
    30_000,
  );
}

for (const row of capabilityMatrix.filter(
  (entry) =>
    entry.id === 'sveltekit-build' &&
    (!process.env.E2E_INTEGRATION || entry.integration === process.env.E2E_INTEGRATION) &&
    (!process.env.E2E_APPLICATION ||
      (entry.application ?? entry.integration) === process.env.E2E_APPLICATION) &&
    (!process.env.E2E_RUNTIME || entry.host === process.env.E2E_RUNTIME),
)) {
  it('capability: ' + row.id, () => {
    const app = applicationDirectory('sveltekit');
    expect(
      existsSync(join(app, 'build/index.js')),
      'Actual protected production build must exist',
    ).toBe(true);
    expect(existsSync(join(app, 'build/prerendered/api'))).toBe(false);
    expect(existsSync(join(app, '.svelte-kit/output/prerendered/pages/api'))).toBe(false);
  });
}

for (const row of capabilityMatrix.filter(
  (entry) =>
    entry.id === 'astro-build' &&
    (!process.env.E2E_INTEGRATION || entry.integration === process.env.E2E_INTEGRATION) &&
    (!process.env.E2E_APPLICATION ||
      (entry.application ?? entry.integration) === process.env.E2E_APPLICATION) &&
    (!process.env.E2E_RUNTIME || entry.host === process.env.E2E_RUNTIME),
)) {
  it('capability: ' + row.id, () => {
    const app = applicationDirectory('astro');
    expect(
      existsSync(join(app, 'dist/server/entry.mjs')),
      'Actual protected Astro build must exist',
    ).toBe(true);
    expect(existsSync(join(app, 'dist/client/api'))).toBe(false);
  });
}

for (const row of capabilityMatrix.filter(
  (entry) =>
    entry.id === 'astro-type-repair' &&
    (!process.env.E2E_INTEGRATION || entry.integration === process.env.E2E_INTEGRATION) &&
    (!process.env.E2E_APPLICATION ||
      (entry.application ?? entry.integration) === process.env.E2E_APPLICATION) &&
    (!process.env.E2E_RUNTIME || entry.host === process.env.E2E_RUNTIME),
)) {
  it('capability: ' + row.id, () => {
    const app = applicationDirectory('astro');
    const workspace = resolve(import.meta.dirname, '../../..');
    const installationRoot =
      realpathSync(app) === realpathSync(join(workspace, 'e2e/apps/astro')) ? workspace : app;
    const output = execFileSync(
      process.env.MIN_NODE_BIN ?? process.execPath,
      [
        '--input-type=module',
        '-e',
        "import { repairAstroTypes } from '@serverless-jwt/astro/type-repair'; process.stdout.write(JSON.stringify(repairAstroTypes({ check: true, installationRoot: " +
          JSON.stringify(installationRoot) +
          ' })));',
      ],
      { cwd: app, encoding: 'utf8', timeout: 10_000 },
    );
    expect(JSON.parse(output)).toEqual({ version: '7.4.5', changed: 0 });
  });
}
