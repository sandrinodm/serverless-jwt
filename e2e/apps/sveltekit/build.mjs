import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempDisposableSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Isolates platform tooling configuration without forwarding account credentials.
 */
using temporary = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-sveltekit-build-state-'));
/**
 * Only the selected build target and verified tool path cross the CLI boundary.
 */
const environment = {
  PATH: process.env.PATH ?? '',
  NODE_ENV: 'production',
  SJWT_CLOUDFLARE: process.env.SJWT_CLOUDFLARE === '1' ? '1' : '0',
  WRANGLER_SEND_METRICS: 'false',
  CI: '1',
  XDG_CONFIG_HOME: join(temporary.path, 'config'),
  XDG_CACHE_HOME: join(temporary.path, 'cache'),
  XDG_DATA_HOME: join(temporary.path, 'data'),
};

execFileSync('pnpm', ['exec', 'vp', 'build', '--config', 'vite.app.config.ts'], {
  cwd: import.meta.dirname,
  env: environment,
  stdio: 'inherit',
  timeout: 180_000,
});
if (
  existsSync(new URL('./build/prerendered/api', import.meta.url)) ||
  existsSync(new URL('./.svelte-kit/output/prerendered/pages/api', import.meta.url))
) {
  throw new Error('Protected static artifacts are forbidden');
}

execFileSync('pnpm', ['test:types'], {
  cwd: import.meta.dirname,
  env: environment,
  stdio: 'inherit',
  timeout: 180_000,
});
