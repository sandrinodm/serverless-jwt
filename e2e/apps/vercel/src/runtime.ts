import { resolve } from 'node:path';

import { applicationDirectory, snapshotApplication } from '../../../harness/src/release.ts';
import { runtimePort, spawnRuntime } from '../../../harness/src/runtime.ts';
import { prepareVercelDevelopment } from '../../../harness/src/vercel-development.ts';

/**
 * Runs actual Vercel output on Node24 or the actual account-free local Vercel CLI.
 */
export async function spawnVercel(
  issuer: string,
  tokens: ReadonlyArray<string>,
  configuration: string,
  jwksUri?: string,
  development = false,
): ReturnType<typeof spawnRuntime> {
  const source = applicationDirectory('vercel');
  const app = snapshotApplication(source, configuration);
  if (development) {
    await prepareVercelDevelopment(source, app);
  }

  const root = resolve(import.meta.dirname, '../../../..');
  const port = await runtimePort();
  const command = development ? process.execPath : process.env.MIN_NODE_BIN;
  if (!command) {
    throw new Error('Vercel output contracts require MIN_NODE_BIN for Node 24');
  }

  const args = development
    ? [
        resolve(app, 'node_modules/vercel/dist/index.js'),
        'dev',
        '--local',
        '--listen',
        '127.0.0.1:' + port,
        '--global-config',
        resolve(configuration, 'global'),
      ]
    : ['src/output-host.mjs'];
  return spawnRuntime({
    command,
    args,
    cwd: app,
    url: 'http://127.0.0.1:' + port,
    tokens,
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: development ? 'development' : 'production',
      ISSUER: issuer,
      PORT: String(port),
      ...(jwksUri ? { JWKS_URI: jwksUri } : {}),
      NODE_EXTRA_CA_CERTS: resolve(root, 'packages/testkit/fixtures/ca.crt'),
      NODE_TLS_REJECT_UNAUTHORIZED: '1',
      CI: '1',
      EXPERIMENTAL_NODE_TYPESCRIPT_ERRORS: '1',
      VERCEL_TELEMETRY_DISABLED: '1',
      NO_UPDATE_NOTIFIER: '1',
      XDG_CONFIG_HOME: resolve(configuration, 'config'),
      XDG_CACHE_HOME: resolve(configuration, 'cache'),
      XDG_DATA_HOME: resolve(configuration, 'data'),
      npm_config_cache: resolve(configuration, 'npm-cache'),
    },
  });
}
