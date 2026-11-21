import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Public manifests are the sole inventory authority; private examples never enter a release.
 */
export interface Manifest {
  /**
   * Canonical npm package identity within the retained scope.
   */
  readonly name: string;

  /**
   * Shared canonical stable or release-candidate version.
   */
  readonly version: string;

  /**
   * Canonical publishing repository and monorepo location required by provenance policy.
   */
  readonly repository?: { readonly url?: string; readonly directory?: string };

  /**
   * Excludes implementation fixtures and applications from public artifacts.
   */
  readonly private?: boolean;

  /**
   * Packed runtime dependency edges checked for internal workspace policy.
   */
  readonly dependencies?: Readonly<Record<string, string>>;

  /**
   * Optional dependency edges subject to the same release policy.
   */
  readonly optionalDependencies?: Readonly<Record<string, string>>;

  /**
   * Supported framework peer edges inspected before publication.
   */
  readonly peerDependencies?: Readonly<Record<string, string>>;

  /**
   * Development edges must also retain canonical internal workspace references.
   */
  readonly devDependencies?: Readonly<Record<string, string>>;
}

/**
 * Retains D1's original upstream identity after its verified owner rename (repository ID
 * 281962945).
 */
export const repositoryUrl: string = 'git+https://github.com/sandrinodm/serverless-jwt.git';

/**
 * Rejects stale owner metadata before package consumers or release authorization can execute.
 */
export function validateRepository(manifest: Manifest): void {
  assert.ok(manifest.repository?.directory, 'Missing repository.directory');
  assert.match(manifest.repository.directory, /^packages\/[a-z0-9-]+$/);
  assert.equal(
    manifest.repository.url,
    repositoryUrl,
    'Repository URL differs from canonical upstream',
  );
}

/**
 * A public package retains its source path for atomic version preparation.
 */
export interface PublicPackage {
  /**
   * Source manifest path used only during local version preparation.
   */
  readonly path: string;

  /**
   * Parsed public source manifest defining artifact identity.
   */
  readonly manifest: Manifest;

  /**
   * Exact flat pnpm artifact filename authorized for this package.
   */
  readonly filename: string;
}

/**
 * Uses the script checkout by default, with explicit roots for disposable tests.
 */
export const root: string = resolve(import.meta.dirname, '..');

/**
 * Executes bounded argument arrays without a shell or inherited npm token configuration.
 */
export function command(file: string, args: ReadonlyArray<string>, cwd: string = root): string {
  return execFileSync(file, [...args], {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

/**
 * Derives only the two reviewed channels and rejects ambiguous or noncanonical versions.
 */
export function channel(version: string): 'latest' | 'next' {
  const number = '(0|[1-9][0-9]*)';
  assert.match(
    version,
    new RegExp(`^${number}\\.${number}\\.${number}(-rc\\.${number})?$`),
    'Version must be X.Y.Z or X.Y.Z-rc.N',
  );
  assert.ok(version.length <= 256, 'Semver exceeds length bound');
  const core = version.split('-')[0];
  assert.ok(
    core && core.split('.').every((part) => Number.isSafeInteger(Number(part))),
    'Semver component exceeds safe integer',
  );
  return version.includes('-') ? 'next' : 'latest';
}

/**
 * Finds actual public manifests and rejects duplicate names, mixed versions and unsafe filenames.
 */
export function publicPackages(directory: string = root): ReadonlyArray<PublicPackage> {
  const result = readdirSync(resolve(directory, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = resolve(directory, 'packages', entry.name, 'package.json');
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest;
      return {
        path,
        manifest,
        filename: `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`,
      };
    })
    .filter(({ manifest }) => manifest.private !== true)
    .sort((a, b) =>
      a.manifest.name === '@serverless-jwt/jwt-verifier'
        ? -1
        : b.manifest.name === '@serverless-jwt/jwt-verifier'
          ? 1
          : a.manifest.name.localeCompare(b.manifest.name),
    );
  assert.ok(result.length > 0, 'No public packages');
  assert.equal(
    new Set(result.map(({ manifest }) => manifest.name)).size,
    result.length,
    'Duplicate package',
  );
  for (const { manifest } of result) {
    assert.match(manifest.name, /^@serverless-jwt\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
    channel(manifest.version);
    validateRepository(manifest);
    assert.equal(manifest.version, result[0]?.manifest.version, 'Mixed package versions');
  }

  return result;
}

/**
 * Hashes the precise bytes that were tested, downloaded or published.
 */
export function digest(
  bytes: Uint8Array,
  algorithm: 'sha256' | 'sha512',
  encoding: 'hex' | 'base64' = 'hex',
): string {
  return createHash(algorithm).update(bytes).digest(encoding);
}

/**
 * Validates a flat, regular-file-only artifact and returns filenames with SHA512SUMS last.
 */
export function checkDirectory(
  directory: string,
  packages: ReadonlyArray<PublicPackage>,
): ReadonlyArray<string> {
  const expected = [...packages.map(({ filename }) => filename), 'SHA512SUMS'];
  assert.deepEqual(
    readdirSync(directory).sort(),
    [...expected].sort(),
    'Artifact inventory differs',
  );
  for (const filename of expected) {
    assert.ok(
      lstatSync(resolve(directory, filename)).isFile(),
      'Artifact entry must be a regular file',
    );
  }

  const sums = readFileSync(resolve(directory, 'SHA512SUMS'), 'utf8');
  assert.ok(sums.endsWith('\n'), 'Checksum manifest must end with newline');
  const lines = sums.slice(0, -1).split('\n');
  const seen = new Set<string>();
  for (const line of lines) {
    const match = /^([a-f0-9]{128})  ([a-z0-9.-]+\.tgz)$/.exec(line);
    assert.ok(match?.[1] && match[2], 'Malformed checksum record');
    assert.ok(!seen.has(match[2]), 'Duplicate checksum record');
    seen.add(match[2]);
    assert.ok(expected.includes(match[2]), 'Unexpected checksum filename');
    assert.equal(
      digest(readFileSync(resolve(directory, match[2])), 'sha512'),
      match[1],
      'Tarball checksum mismatch',
    );
  }

  assert.deepEqual(
    [...seen].sort(),
    packages.map(({ filename }) => filename).sort(),
    'Incomplete checksums',
  );
  return expected;
}

/**
 * Removes token and user configuration inheritance before invoking npm in a disposable directory.
 */
export function npmEnvironment(userconfig: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /token|password|secret|^npm_config_|^node_options$|^node_path$/i.test(key) &&
      !key.startsWith('ACTIONS_ID_TOKEN_REQUEST_')
    ) {
      delete env[key];
    }
  }

  env.NPM_CONFIG_USERCONFIG = userconfig;
  env.NPM_CONFIG_GLOBALCONFIG = `${userconfig}.global`;
  env.NPM_CONFIG_IGNORE_SCRIPTS = 'true';
  return env;
}
