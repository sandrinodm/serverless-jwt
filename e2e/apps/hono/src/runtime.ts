import { resolve } from 'node:path';

import { applicationDirectory } from '../../../harness/src/release.ts';
import { runtimePort, spawnRuntime } from '../../../harness/src/runtime.ts';

/**
 * Supported actual Hono hosts share one built app and separately owned native servers.
 */
export type HonoRuntime = 'node' | 'bun' | 'deno' | 'workerd';

/**
 * Spawns one real runtime in a bounded, isolated, certificate-verifying environment.
 */
export async function spawnHono(
  runtime: HonoRuntime,
  issuer: string,
  tokens: ReadonlyArray<string>,
  configuration: string,
  jwksUri?: string,
): ReturnType<typeof spawnRuntime> {
  const app = applicationDirectory('hono');
  const root = resolve(import.meta.dirname, '../../../..');
  const ca = resolve(root, 'packages/testkit/fixtures/ca.crt');
  const port = await runtimePort();
  const common = {
    PATH: process.env.PATH ?? '',
    NODE_ENV: 'test',
    XDG_CONFIG_HOME: configuration,
    NODE_TLS_REJECT_UNAUTHORIZED: '1',
    NODE_EXTRA_CA_CERTS: ca,
    ISSUER: issuer,
    PORT: String(port),
    ...(jwksUri ? { JWKS_URI: jwksUri } : {}),
  };
  let command: string;
  let args: string[];
  if (runtime === 'workerd') {
    command = process.execPath;
    args = [
      resolve(app, 'node_modules/wrangler/bin/wrangler.js'),
      'dev',
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      '0',
      '--show-interactive-dev-session=false',
      '--var',
      'ISSUER:' + issuer,
      ...(jwksUri ? ['--var', 'JWKS_URI:' + jwksUri] : []),
    ];
  } else if (runtime === 'deno') {
    command = process.env.DENO_BIN ?? 'deno';
    args = [
      'run',
      '--allow-env=ISSUER,JWKS_URI,PORT',
      '--allow-net=127.0.0.1',
      '--cert=' + ca,
      'src/deno.mjs',
    ];
  } else if (runtime === 'bun') {
    command = process.env.BUN_BIN ?? 'bun';
    args = ['--no-install', 'src/bun.mjs'];
  } else {
    command = process.execPath;
    args = ['src/node.mjs'];
  }

  return spawnRuntime({
    command,
    args,
    cwd: app,
    url: 'http://127.0.0.1:' + port,
    tokens,
    env: {
      ...common,
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_LOG_PATH: resolve(configuration, 'wrangler-logs'),
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    },
  });
}
