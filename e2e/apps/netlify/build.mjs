import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempDisposableSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * Owns account-free CLI state during the actual offline production build.
 */
using temporary = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-netlify-build-'));
/**
 * Keeps ancestor workspace lockfiles from changing the site's base directory.
 */
const app = import.meta.dirname;
/**
 * Owns a complete isolated site copy for the real CLI.
 */
const staged = join(temporary.path, 'app');
mkdirSync(staged);
for (const file of ['netlify', 'public', 'netlify.toml', 'package.json', 'capabilities.ts']) {
  cpSync(resolve(app, file), resolve(staged, file), { recursive: true });
}

symlinkSync(resolve(app, 'node_modules'), resolve(staged, 'node_modules'), 'dir');
execFileSync(
  process.execPath,
  [resolve(app, 'node_modules/netlify-cli/bin/run.js'), 'build', '--offline'],
  {
    cwd: staged,
    env: {
      PATH:
        (process.env.DENO_BIN ? dirname(process.env.DENO_BIN) + ':' : '') +
        (process.env.PATH ?? ''),
      XDG_CONFIG_HOME: join(temporary.path, 'config'),
      XDG_CACHE_HOME: join(temporary.path, 'cache'),
      XDG_DATA_HOME: join(temporary.path, 'data'),
      NETLIFY_TELEMETRY_DISABLED: '1',
      DO_NOT_TRACK: '1',
      NO_UPDATE_NOTIFIER: '1',
      CI: '1',
      BROWSER: 'none',
    },
    stdio: 'inherit',
    timeout: 180_000,
  },
);

cpSync(resolve(staged, '.netlify'), resolve(app, '.netlify'), { recursive: true });
