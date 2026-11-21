import { mkdtempDisposableSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, inject, it } from 'vite-plus/test';

import { spawnAstro } from '../../apps/astro/src/runtime.ts';
import { spawnSvelteKit } from '../../apps/sveltekit/src/runtime.ts';

for (const [framework, spawn] of [
  ['Astro', spawnAstro],
  ['SvelteKit', spawnSvelteKit],
] as const) {
  it(
    'returns the endpoint 401 challenge when ' + framework + ' protection misses the route',
    async () => {
      using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-endpoint-auth-'));
      const app = await spawn(inject('e2eUrls').oidc, [], directory.path);
      try {
        const response = await fetch(app.url + '/endpoint-auth');
        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe('Bearer realm="api"');
        expect(response.headers.get('cache-control')).toBe('no-store');
      } finally {
        await app.close();
      }
    },
  );
}

for (const [framework, spawn] of [
  ['Astro', spawnAstro],
  ['SvelteKit', spawnSvelteKit],
] as const) {
  it(
    'preserves the configured quoted realm in native ' + framework + ' endpoint challenges',
    async () => {
      using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-endpoint-realm-'));
      const app = await spawn(
        inject('e2eUrls').oidc,
        [],
        directory.path,
        undefined,
        'private "realm"\\zone',
      );
      try {
        const response = await fetch(app.url + '/endpoint-auth');
        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe(
          'Bearer realm="private \\"realm\\"\\\\zone"',
        );
        expect(response.headers.get('cache-control')).toBe('no-store');
      } finally {
        await app.close();
      }
    },
  );
}
