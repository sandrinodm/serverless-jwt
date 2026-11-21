import { resolve } from 'node:path';

import { applicationDirectory, snapshotApplication } from '../../../harness/src/release.ts';
import { runtimePort, spawnRuntime } from '../../../harness/src/runtime.ts';

/**
 * Serves real @astrojs/node standalone output against the verified HTTPS fixture issuer.
 */
export async function spawnAstro(
  issuer: string,
  tokens: ReadonlyArray<string>,
  configuration: string,
  jwksUri?: string,
  realm?: string,
): ReturnType<typeof spawnRuntime> {
  const app = snapshotApplication(applicationDirectory('astro'), configuration);
  const port = await runtimePort();
  return spawnRuntime({
    command: process.execPath,
    args: ['dist/server/entry.mjs'],
    cwd: app,
    url: 'http://127.0.0.1:' + port,
    tokens,
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      ISSUER: issuer,
      AUTH_REALM: realm ?? 'api',
      ...(jwksUri ? { JWKS_URI: jwksUri } : {}),
      XDG_CONFIG_HOME: configuration,
      NODE_EXTRA_CA_CERTS: resolve(
        import.meta.dirname,
        '../../../../packages/testkit/fixtures/ca.crt',
      ),
      NODE_TLS_REJECT_UNAUTHORIZED: '1',
    },
  });
}
