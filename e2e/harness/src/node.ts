import { resolve } from 'node:path';

import { applicationDirectory } from './release.ts';
import { runtimePort, spawnRuntime } from './runtime.ts';

/**
 * Runs the accepted Node examples with their own installed package graph and trusted HTTPS issuer.
 */
export async function spawnNodeApplication(
  name: string,
  issuer: string,
  tokens: ReadonlyArray<string>,
  configuration: string,
  jwksUri?: string,
): ReturnType<typeof spawnRuntime> {
  const app = applicationDirectory(name);
  const port = await runtimePort();
  return spawnRuntime({
    command: process.env.MIN_NODE_BIN ?? process.execPath,
    args:
      name === 'next-pages'
        ? [
            'node_modules/next/dist/bin/next',
            'start',
            '--hostname',
            '127.0.0.1',
            '--port',
            String(port),
          ]
        : [name === 'nuxt' ? '.output/server/index.mjs' : 'src/app.ts'],
    cwd: app,
    env: {
      PATH: process.env.PATH ?? '',
      ISSUER: issuer,
      ...(jwksUri ? { JWKS_URI: jwksUri } : {}),
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      XDG_CONFIG_HOME: configuration,
      NODE_EXTRA_CA_CERTS: resolve(
        import.meta.dirname,
        '../../../packages/testkit/fixtures/ca.crt',
      ),
      NODE_TLS_REJECT_UNAUTHORIZED: '1',
    },
    url: 'http://127.0.0.1:' + port,
    tokens,
  });
}
