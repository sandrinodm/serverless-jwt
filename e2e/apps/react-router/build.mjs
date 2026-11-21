import { execFileSync } from 'node:child_process';
import { mkdtempDisposableSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Real framework production compilation and mandatory types use isolated local CLI state.
 */
using temporary = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-react-router-build-'));
/**
 * Account and telemetry environment is excluded from the bounded local build.
 */
const environment = {
  PATH: process.env.PATH ?? '',
  NODE_ENV: 'production',
  XDG_CONFIG_HOME: join(temporary.path, 'config'),
  XDG_CACHE_HOME: join(temporary.path, 'cache'),
  XDG_DATA_HOME: join(temporary.path, 'data'),
};
execFileSync('pnpm', ['exec', 'react-router', 'build', '--config', 'vite.app.config.ts'], {
  cwd: import.meta.dirname,
  env: environment,
  stdio: 'inherit',
  timeout: 180_000,
});
execFileSync('pnpm', ['test:types'], {
  cwd: import.meta.dirname,
  env: environment,
  stdio: 'inherit',
  timeout: 180_000,
});
