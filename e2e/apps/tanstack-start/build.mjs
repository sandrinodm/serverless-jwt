import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempDisposableSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Account-free native framework builds retain default Start request/CSRF configuration.
 */
using temporary = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-start-build-'));
for (const framework of ['react', 'solid']) {
  const app = resolve(import.meta.dirname, framework);
  // Nitro can retain obsolete public chunks; security scans inspect fresh generated output only.
  rmSync(join(app, '.output'), { recursive: true, force: true });
  execFileSync(
    'pnpm',
    [
      'exec',
      'vp',
      'build',
      '--config',
      resolve(import.meta.dirname, 'vite.' + framework + '.app.config.ts'),
    ],
    {
      cwd: app,
      timeout: 180_000,
      stdio: 'inherit',
      env: {
        PATH: process.env.PATH ?? '',
        NODE_ENV: 'production',
        XDG_CONFIG_HOME: join(temporary.path, framework, 'config'),
        XDG_CACHE_HOME: join(temporary.path, framework, 'cache'),
      },
    },
  );
  const output = join(app, '.output');
  if (!existsSync(join(output, 'server/index.mjs'))) {
    throw new Error('Missing actual Nitro production server output');
  }

  if (existsSync(join(output, 'public/api')) || existsSync(join(output, 'public/_serverFn'))) {
    throw new Error('Protected API and RPC static artifacts are forbidden');
  }

  /**
   * All browser artifacts, including dynamically loaded RPC chunks, must exclude private policy.
   */
  const inspect = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        inspect(path);
      } else if (/\.(?:js|mjs|map|json)$/.test(entry.name)) {
        const code = readFileSync(path, 'utf8');
        for (const forbidden of [
          'P4_PRIVATE_POLICY_',
          'P4_PRIVATE_RPC_',
          'jwks_fetch_failed',
          'integration.on_error_failed',
          'node:async_hooks',
        ]) {
          if (code.includes(forbidden)) {
            throw new Error('Server authentication policy reached browser output');
          }
        }
      }
    }
  };
  inspect(join(output, 'public'));
}

execFileSync('pnpm', ['test:types'], {
  cwd: import.meta.dirname,
  stdio: 'inherit',
  timeout: 180_000,
});
