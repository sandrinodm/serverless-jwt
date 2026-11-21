import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Resolves the exact packed artifacts supplied for the standalone public example.
 */
const artifactDirectory = resolve(process.argv[2] ?? 'artifacts');
/**
 * Finds the public core archive without installing unrelated integration peers.
 */
const candidates = readdirSync(artifactDirectory)
  .filter((name) => name.endsWith('.tgz'))
  .map((name) => {
    const path = join(artifactDirectory, name);
    const manifest = JSON.parse(
      execFileSync('tar', ['-xOf', path, 'package/package.json'], { encoding: 'utf8' }),
    );
    return { path, manifest };
  })
  .filter(({ manifest }) => manifest.name === '@serverless-jwt/jwt-verifier');
assert.equal(candidates.length, 1, 'Supply exactly one packed core artifact');
/**
 * Selects the single verified core archive and its manifest for the disposable consumer.
 */
const [{ path: tarball, manifest }] = candidates;
/**
 * Creates an outside-workspace example consumer to prevent workspace source resolution.
 */
const consumer = mkdtempSync(
  join(process.env.DOCS_CONSUMER_ROOT ?? tmpdir(), 'serverless-jwt-public-example-'),
);
try {
  cpSync(resolve('docs/examples/verify-locally'), consumer, { recursive: true });
  const input = JSON.parse(readFileSync(join(consumer, 'package.json'), 'utf8'));
  input.dependencies[manifest.name] = 'file:' + tarball;
  writeFileSync(join(consumer, 'package.json'), JSON.stringify(input));
  writeFileSync(
    join(consumer, 'pnpm-workspace.yaml'),
    'minimumReleaseAge: 10080\nminimumReleaseAgeStrict: true\n',
  );
  execFileSync('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], {
    cwd: consumer,
    stdio: 'inherit',
    timeout: 180_000,
  });
  const installed = JSON.parse(
    readFileSync(join(consumer, 'node_modules/@serverless-jwt/jwt-verifier/package.json'), 'utf8'),
  );
  assert.equal(installed.version, manifest.version);
  execFileSync(process.env.MIN_NODE_BIN ?? process.execPath, ['verify.mjs'], {
    cwd: consumer,
    stdio: 'inherit',
    timeout: 30_000,
  });
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
