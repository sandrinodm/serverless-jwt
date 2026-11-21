import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Local-only settings allow the real CLI build without account IDs, linking, pulling or login.
 */
const app = import.meta.dirname;
/**
 * Owns all user-level CLI configuration/cache state during this build.
 */
using temporary = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-vercel-build-'));
mkdirSync(resolve(app, '.vercel'), { recursive: true });
writeFileSync(
  resolve(app, '.vercel/project.json'),
  JSON.stringify({
    settings: {
      framework: null,
      nodeVersion: '24.x',
      installCommand: 'true',
      buildCommand: null,
      outputDirectory: null,
    },
  }),
);
execFileSync(
  process.execPath,
  [
    resolve(app, 'node_modules/vercel/dist/index.js'),
    'build',
    '--global-config',
    join(temporary.path, 'global'),
  ],
  {
    cwd: app,
    env: {
      PATH: process.env.PATH ?? '',
      CI: '1',
      EXPERIMENTAL_NODE_TYPESCRIPT_ERRORS: '1',
      VERCEL_TELEMETRY_DISABLED: '1',
      NO_UPDATE_NOTIFIER: '1',
      XDG_CONFIG_HOME: join(temporary.path, 'config'),
      XDG_CACHE_HOME: join(temporary.path, 'cache'),
      XDG_DATA_HOME: join(temporary.path, 'data'),
      npm_config_cache: join(temporary.path, 'npm-cache'),
    },
    stdio: 'inherit',
    timeout: 180_000,
  },
);
