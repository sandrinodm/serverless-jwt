import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempDisposableSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * CLI state remains private and telemetry/account environment is not forwarded.
 */
using temporary = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-astro-build-state-'));
/**
 * The real build and mandatory types use the same isolated toolchain environment.
 */
const environment = {
  PATH: process.env.PATH ?? '',
  NODE_ENV: 'production',
  ASTRO_TELEMETRY_DISABLED: '1',
  XDG_CONFIG_HOME: join(temporary.path, 'config'),
  XDG_CACHE_HOME: join(temporary.path, 'cache'),
  XDG_DATA_HOME: join(temporary.path, 'data'),
};

execFileSync('pnpm', ['prepare:peers'], {
  cwd: import.meta.dirname,
  env: environment,
  stdio: 'inherit',
  timeout: 180_000,
});
execFileSync('pnpm', ['repair:types'], {
  cwd: import.meta.dirname,
  env: environment,
  stdio: 'inherit',
  timeout: 180_000,
});

execFileSync(
  process.execPath,
  [resolve(import.meta.dirname, 'node_modules/astro/bin/astro.mjs'), 'build'],
  { cwd: import.meta.dirname, env: environment, stdio: 'inherit', timeout: 180_000 },
);
if (existsSync(new URL('./dist/client/api', import.meta.url))) {
  throw new Error('Protected static artifacts are forbidden');
}

execFileSync('pnpm', ['test:types'], {
  cwd: import.meta.dirname,
  env: environment,
  stdio: 'inherit',
  timeout: 180_000,
});
