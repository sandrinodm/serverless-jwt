import { resolve } from 'node:path';

import { applicationDirectory } from './release.ts';
import { runtimePort, spawnRuntime } from './runtime.ts';

/**
 * Start independently built plain Nitro or SolidStart output under minimum supported Node.
 */
export async function spawnNitroHost(
  name: 'nitro' | 'solidstart',
  issuer: string,
  tokens: ReadonlyArray<string>,
  configuration: string,
  jwksUri?: string,
): ReturnType<typeof spawnRuntime> {
  const port = await runtimePort();
  return spawnRuntime({
    command: process.env.MIN_NODE_BIN ?? process.execPath,
    args: ['.output/server/index.mjs'],
    cwd: applicationDirectory(name),
    env: {
      PATH: process.env.PATH ?? '',
      ISSUER: issuer,
      ...(jwksUri ? { JWKS_URI: jwksUri } : {}),
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
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
