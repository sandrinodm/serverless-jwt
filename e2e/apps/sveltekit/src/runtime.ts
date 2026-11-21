import { resolve } from 'node:path';

import { applicationDirectory, snapshotApplication } from '../../../harness/src/release.ts';
import { runtimePort, spawnRuntime } from '../../../harness/src/runtime.ts';

/**
 * Runs the actual adapter-node production output against verified fixture HTTPS issuers.
 */
export async function spawnSvelteKit(
  issuer: string,
  tokens: ReadonlyArray<string>,
  configuration: string,
  jwksUri?: string,
  realm?: string,
): ReturnType<typeof spawnRuntime> {
  const app = snapshotApplication(applicationDirectory('sveltekit'), configuration);
  const port = await runtimePort();
  return spawnRuntime({
    command: process.execPath,
    args: ['build/index.js'],
    cwd: app,
    url: 'http://127.0.0.1:' + port,
    tokens,
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      ORIGIN: 'http://127.0.0.1:' + port,
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

/**
 * Serves the actual adapter-cloudflare artifact in workerd with isolated CLI state and verified
 * TLS.
 */
export async function spawnSvelteKitWorker(
  issuer: string,
  tokens: ReadonlyArray<string>,
  configuration: string,
  jwksUri?: string,
): ReturnType<typeof spawnRuntime> {
  const app = snapshotApplication(applicationDirectory('sveltekit'), configuration);
  const port = await runtimePort();
  return spawnRuntime({
    command: process.execPath,
    args: [
      resolve(app, 'node_modules/wrangler/bin/wrangler.js'),
      'dev',
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--persist-to',
      resolve(configuration, 'state'),
      '--var',
      'ISSUER:' + issuer,
      ...(jwksUri ? ['--var', 'JWKS_URI:' + jwksUri] : []),
    ],
    cwd: app,
    url: 'http://127.0.0.1:' + port,
    tokens,
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'production',
      WRANGLER_SEND_METRICS: 'false',
      XDG_CONFIG_HOME: resolve(configuration, 'config'),
      XDG_CACHE_HOME: resolve(configuration, 'cache'),
      XDG_DATA_HOME: resolve(configuration, 'data'),
      NODE_EXTRA_CA_CERTS: resolve(
        import.meta.dirname,
        '../../../../packages/testkit/fixtures/ca.crt',
      ),
      NODE_TLS_REJECT_UNAUTHORIZED: '1',
      CI: '1',
    },
  });
}
