import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempDisposableSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Verifies reviewed declaration peers resolve from the actual packed package under pnpm isolation.
 */
export function verifyPnpmConsumer(root, tarball, manifest, internal, source) {
  using temporary = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-pnpm-consumer-'));
  const consumer = temporary.path;
  const timeout = 180_000;
  /**
   * Bounds the isolated installer and strict compiler without altering the source checkout.
   */
  const run = (command, args) =>
    execFileSync(command, args, { cwd: consumer, timeout, stdio: 'inherit' });
  const version = execFileSync('pnpm', ['--version'], {
    cwd: consumer,
    encoding: 'utf8',
    timeout,
  }).trim();
  assert.equal(version, '12.17.0');
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: {
        [manifest.name]: 'file:' + tarball,
        ...Object.fromEntries([...internal].map(([name, path]) => [name, 'file:' + path])),
        ...Object.fromEntries(
          Object.entries(manifest.peerDependencies ?? {}).filter(([name]) => !internal.has(name)),
        ),
      },
    }),
  );
  writeFileSync(
    join(consumer, 'pnpm-workspace.yaml'),
    JSON.stringify({
      minimumReleaseAge: 10080,
      minimumReleaseAgeStrict: true,
      overrides: Object.fromEntries([...internal].map(([name, path]) => [name, 'file:' + path])),
    }),
  );
  run('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile']);
  cpSync(join(source, 'fixtures/consumer.ts'), join(consumer, 'consumer.ts'));
  for (const mode of ['nodenext', 'bundler']) {
    writeFileSync(
      join(consumer, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          target: 'ES2023',
          lib: ['ES2023', 'DOM', 'DOM.Iterable'],
          types: [],
          module: mode === 'nodenext' ? 'nodenext' : 'esnext',
          moduleResolution: mode,
        },
        files: ['consumer.ts'],
      }),
    );
    run(join(root, 'node_modules/.bin/tsc'), ['-p', join(consumer, 'tsconfig.json')]);
  }

  writeFileSync(join(consumer, 'probe.mjs'), "await import('@serverless-jwt/next');\n");
  run(process.execPath, ['probe.mjs']);
  console.log('Verified exact Next declaration correction under isolated pnpm layout.');
}
