import { join, resolve } from 'node:path';

import { applicationDirectory } from './release.ts';
import { runtimePort, spawnRuntime } from './runtime.ts';

/**
 * Runs an account-free Wrangler process in isolated configuration with verified workerd TLS.
 */
export async function cloudflareApp(
  form: 'workers' | 'pages',
  issuer: string,
  tokens: ReadonlyArray<string>,
  configDirectory: string,
  jwksUri?: string,
  trusted = true,
): ReturnType<typeof spawnRuntime> {
  const root = resolve(import.meta.dirname, '../../..');
  const app = applicationDirectory('cloudflare');
  const port = await runtimePort();
  const bindings = ['ISSUER', issuer, ...(jwksUri ? ['JWKS_URI', jwksUri] : [])];
  const args =
    form === 'workers'
      ? [
          'dev',
          '--local',
          ...bindings.flatMap((value, index) =>
            index % 2 === 0 ? ['--var', value + ':' + bindings[index + 1]] : [],
          ),
        ]
      : [
          'pages',
          'dev',
          'public',
          ...bindings.flatMap((value, index) =>
            index % 2 === 0 ? ['--binding', value + '=' + bindings[index + 1]] : [],
          ),
        ];
  return spawnRuntime({
    command: process.execPath,
    args: [
      join(app, 'node_modules/wrangler/bin/wrangler.js'),
      ...args,
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      '0',
      '--show-interactive-dev-session=false',
    ],
    cwd: form === 'workers' ? app : join(app, 'pages'),
    env: {
      PATH: process.env.PATH ?? '',
      XDG_CONFIG_HOME: configDirectory,
      WRANGLER_LOG_PATH: join(configDirectory, 'logs'),
      WRANGLER_SEND_METRICS: 'false',
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
      NODE_TLS_REJECT_UNAUTHORIZED: '1',
      ...(trusted ? { NODE_EXTRA_CA_CERTS: join(root, 'packages/testkit/fixtures/ca.crt') } : {}),
    },
    url: 'http://127.0.0.1:' + port,
    tokens,
  });
}
