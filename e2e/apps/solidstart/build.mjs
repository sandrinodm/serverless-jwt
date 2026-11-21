import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Compile real SolidStart client/server environments and reject static protected output.
 */
rmSync(join(import.meta.dirname, '.output'), { recursive: true, force: true });
execFileSync('pnpm', ['exec', 'vp', 'build', '--config', 'vite.app.config.ts'], {
  cwd: import.meta.dirname,
  stdio: 'inherit',
  timeout: 180_000,
});
if (
  !existsSync(join(import.meta.dirname, '.output/server/index.mjs')) ||
  existsSync(join(import.meta.dirname, '.output/public/protected'))
) {
  throw new Error('Native SolidStart must emit its server without a static protected route');
}

execFileSync('pnpm', ['test:types'], {
  cwd: import.meta.dirname,
  stdio: 'inherit',
  timeout: 180_000,
});
