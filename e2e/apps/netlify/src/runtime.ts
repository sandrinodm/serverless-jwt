import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { assertNetlifyLoggingPatch } from '../../../../scripts/netlify-logging.ts';
import { applicationDirectory, snapshotApplication } from '../../../harness/src/release.ts';
import { runtimePort, spawnRuntime } from '../../../harness/src/runtime.ts';

/**
 * Starts the actual offline Functions and Deno Edge CLI with verified HTTPS and private CLI state.
 */
export async function spawnNetlify(
  issuer: string,
  tokens: ReadonlyArray<string>,
  configuration: string,
  jwksUri?: string,
): ReturnType<typeof spawnRuntime> {
  const app = applicationDirectory('netlify');
  assertNetlifyLoggingPatch(app);
  const root = resolve(import.meta.dirname, '../../../..');
  const port = await runtimePort();
  const staged = snapshotApplication(app, configuration);
  const deno = process.env.DENO_BIN;
  if (!deno) {
    throw new Error('Netlify Edge contracts require the verified DENO_BIN');
  }

  mkdirSync(configuration, { recursive: true });
  // Netlify deliberately filters parent environment for Edge. These keys must come only from .env.
  writeFileSync(
    resolve(staged, '.env'),
    [
      'ISSUER=' + issuer,
      ...(jwksUri ? ['JWKS_URI=' + jwksUri] : []),
      'DENO_CERT=' + resolve(root, 'packages/testkit/fixtures/ca.crt'),
      'DENO_DIR=' + resolve(configuration, 'deno-cache'),
    ].join('\n') + '\n',
    { mode: 0o600 },
  );
  return spawnRuntime({
    command: process.execPath,
    args: [
      resolve(app, 'node_modules/netlify-cli/bin/run.js'),
      'dev',
      '--offline',
      '--no-open',
      '--skip-gitignore',
      '--port',
      String(port),
    ],
    cwd: staged,
    url: 'http://127.0.0.1:' + port,
    tokens,
    env: {
      PATH: dirname(deno) + ':' + (process.env.PATH ?? ''),
      NODE_EXTRA_CA_CERTS: resolve(root, 'packages/testkit/fixtures/ca.crt'),
      NODE_TLS_REJECT_UNAUTHORIZED: '1',
      XDG_CONFIG_HOME: resolve(configuration, 'config'),
      XDG_CACHE_HOME: resolve(configuration, 'cache'),
      XDG_DATA_HOME: resolve(configuration, 'data'),
      NETLIFY_TELEMETRY_DISABLED: '1',
      DO_NOT_TRACK: '1',
      NO_UPDATE_NOTIFIER: '1',
      CI: '1',
      BROWSER: 'none',
    },
  });
}
