import assert from 'node:assert/strict';
import { describe, expect, it } from 'vite-plus/test';

import { startKeycloak } from '../harness/src/keycloak.docker.ts';
import { spawnExample } from '../harness/src/spawn.ts';

describe.skipIf(!process.env.E2E_DOCKER)('real Keycloak HTTPS issuer', () => {
  // Startup imports a complete realm; rotation generates an RSA key and crosses a real cooldown.
  it('real grant, audience mapper rejection and active/passive key rotation', async () => {
    const keycloak = await startKeycloak();
    let app: Awaited<ReturnType<typeof spawnExample>> | undefined;
    try {
      const old = await keycloak.grant();
      const wrong = await keycloak.grant('wrong-client');
      app = await spawnExample(keycloak.issuer, keycloak.tokens, undefined, {
        keys: { cooldown: 1 },
      });
      /**
       * Checks public status without returning compact tokens or issuer errors to test reporters.
       */
      const status = async (token: string): Promise<number> => {
        const response = await fetch(app?.url + '/protected', {
          headers: { authorization: 'Bearer ' + token },
        });
        await response.arrayBuffer();
        return response.status;
      };
      expect(await status(old)).toBe(200);
      expect(await status(wrong)).toBe(401);
      await keycloak.rotate();
      const fresh = await keycloak.grant();
      assert.notEqual(
        JSON.parse(Buffer.from(old.split('.')[0] ?? '', 'base64url').toString()).kid,
        JSON.parse(Buffer.from(fresh.split('.')[0] ?? '', 'base64url').toString()).kid,
        'Realm key rotation did not change signing key',
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 1_150));
      expect(await status(fresh)).toBe(200);
      expect(await status(old)).toBe(200);
    } finally {
      try {
        await app?.close();
      } finally {
        await keycloak.close();
      }
    }
  }, 120_000);
});
