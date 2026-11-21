import { resolve } from 'node:path';

import { assertRouterLoggingPatch } from '../../../../scripts/router-logging.ts';
import { applicationDirectory } from '../../../harness/src/release.ts';
import { runtimePort, spawnRuntime } from '../../../harness/src/runtime.ts';

/**
 * Actual react-router-serve executes production output with independently owned request contexts.
 */
export async function spawnReactRouter(
  issuer: string,
  tokens: ReadonlyArray<string>,
  configuration: string,
  jwksUri?: string,
  logControl?: string,
): ReturnType<typeof spawnRuntime> {
  const app = applicationDirectory('react-router');
  assertRouterLoggingPatch(app);
  const port = await runtimePort();
  return spawnRuntime({
    command: process.execPath,
    args: [resolve(app, 'node_modules/@react-router/serve/bin.cjs'), 'build/server/index.js'],
    cwd: app,
    url: 'http://127.0.0.1:' + port,
    tokens,
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      ISSUER: issuer,
      ...(logControl ? { E2E_LOG_CONTROL: logControl } : {}),
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
