import { resolve } from 'node:path';

import { applicationDirectory } from '../../../harness/src/release.ts';
import { runtimePort, spawnRuntime } from '../../../harness/src/runtime.ts';

/**
 * Both supported frameworks run their own real compiled Nitro production artifact.
 */
export type StartFramework = 'react' | 'solid';

/**
 * Native process boundaries isolate request/function context and verify the fixture HTTPS issuer.
 */
export async function spawnTanStack(
  framework: StartFramework,
  issuer: string,
  tokens: ReadonlyArray<string>,
  configuration: string,
  jwksUri?: string,
): ReturnType<typeof spawnRuntime> {
  const app = resolve(applicationDirectory('tanstack-start'), framework);
  const port = await runtimePort();
  return spawnRuntime({
    command: process.execPath,
    args: ['.output/server/index.mjs'],
    cwd: app,
    url: 'http://127.0.0.1:' + port,
    tokens,
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      ISSUER: issuer,
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
