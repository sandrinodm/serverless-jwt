import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { applicationDirectory, snapshotApplication } from '../../../harness/src/release.ts';
import { runtimePort, spawnRuntime } from '../../../harness/src/runtime.ts';

/**
 * Runs the actual Next production or Turbopack development CLI with only fixture configuration.
 */
export async function spawnNext(
  issuer: string,
  tokens: ReadonlyArray<string>,
  configDirectory: string,
  jwksUri?: string,
  development = false,
): ReturnType<typeof spawnRuntime> {
  const source = applicationDirectory('next');
  const root = resolve(import.meta.dirname, '../../../..');
  const external = Boolean(
    process.env.E2E_APPLICATIONS || process.env.E2E_FROM_TARBALLS || process.env.E2E_FROM_REGISTRY,
  );
  const base = external ? configDirectory : resolve(root, '.cache');
  mkdirSync(base, { recursive: true });
  const snapshot = development ? mkdtempSync(resolve(base, 'next-dev-')) : undefined;
  const app = snapshot ? snapshotApplication(source, snapshot) : source;
  if (snapshot) {
    rmSync(resolve(app, '.next'), { recursive: true, force: true });
  }

  const port = await runtimePort();
  try {
    const runtime = await spawnRuntime({
      command: process.execPath,
      args: [
        resolve(app, 'node_modules/next/dist/bin/next'),
        development ? 'dev' : 'start',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(port),
      ],
      cwd: app,
      env: {
        PATH: process.env.PATH ?? '',
        ISSUER: issuer,
        ...(jwksUri ? { JWKS_URI: jwksUri } : {}),
        NEXT_TELEMETRY_DISABLED: '1',
        NODE_ENV: development ? 'development' : 'production',
        XDG_CONFIG_HOME: configDirectory,
        NODE_EXTRA_CA_CERTS: resolve(root, 'packages/testkit/fixtures/ca.crt'),
        NODE_TLS_REJECT_UNAUTHORIZED: '1',
      },
      url: 'http://127.0.0.1:' + port,
      tokens,
    });
    return {
      ...runtime,
      close: async (): Promise<void> => {
        try {
          await runtime.close();
        } finally {
          if (snapshot) {
            rmSync(snapshot, { recursive: true, force: true });
          }
        }
      },
    };
  } catch (cause) {
    if (snapshot) {
      rmSync(snapshot, { recursive: true, force: true });
    }

    throw cause;
  }
}
