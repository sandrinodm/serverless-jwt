import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempDisposableSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  channel,
  checkDirectory,
  digest,
  npmEnvironment,
  publicPackages,
  root,
} from './release-common.ts';

/**
 * Npm's SLSA v1 bundle identifies subject bytes, source workflow and resolved source revision.
 */
export interface Statement {
  /**
   * Requires the in-toto v1 statement schema used by npm provenance.
   */
  readonly _type: string;

  /**
   * Requires SLSA provenance v1 rather than npm publish metadata.
   */
  readonly predicateType: string;

  /**
   * Exact npm purl and SHA512 must identify the locally tested tarball.
   */
  readonly subject: ReadonlyArray<{
    readonly name: string;
    readonly digest: { readonly sha512: string };
  }>;

  /**
   * Build definition binds repository, workflow, tag and resolved Git commit.
   */
  readonly predicate: {
    readonly buildDefinition: {
      readonly buildType: string;
      readonly externalParameters: {
        readonly workflow: {
          readonly repository: string;
          readonly path: string;
          readonly ref: string;
        };
      };
      readonly resolvedDependencies: ReadonlyArray<{
        readonly uri: string;
        readonly digest: { readonly gitCommit: string };
      }>;
    };
  };
}

/**
 * Validates provenance identity separately from cryptographic verification by npm audit signatures.
 */
export function verifyStatement(
  statement: Statement,
  name: string,
  version: string,
  sha512: string,
): void {
  assert.equal(statement._type, 'https://in-toto.io/Statement/v1');
  assert.equal(statement.predicateType, 'https://slsa.dev/provenance/v1');
  assert.deepEqual(statement.subject, [
    { name: `pkg:npm/${name.replace('@', '%40')}@${version}`, digest: { sha512 } },
  ]);
  const build = statement.predicate.buildDefinition;
  assert.equal(
    build.buildType,
    'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
  );
  const repository = `https://github.com/${process.env.GITHUB_REPOSITORY}`;
  const ref = `refs/tags/v${version}`;
  assert.deepEqual(build.externalParameters.workflow, {
    repository,
    path: '.github/workflows/publish.yml',
    ref,
  });
  assert.ok(
    build.resolvedDependencies.some(
      ({ uri, digest: hash }) =>
        uri === `git+${repository}@${ref}` && hash.gitCommit === process.env.GITHUB_SHA,
    ),
    'Provenance commit differs',
  );
}

/**
 * Decodes only the unique SLSA DSSE envelope; npm subsequently verifies signatures and transparency
 * evidence.
 */
export function statementFromBundle(bundle: {
  /**
   * Registry-discovered DSSE envelopes are selected by their provenance predicate.
   */
  readonly attestations: ReadonlyArray<{
    readonly predicateType: string;
    readonly bundle: {
      readonly dsseEnvelope: {
        readonly payloadType: string;
        readonly payload: string;
      };
    };
  }>;
}): Statement {
  const candidates = bundle.attestations.filter(
    ({ predicateType }) => predicateType === 'https://slsa.dev/provenance/v1',
  );
  assert.equal(candidates.length, 1, 'Exactly one SLSA v1 attestation required');
  const candidate = candidates[0];
  assert.ok(candidate);
  const envelope = candidate.bundle.dsseEnvelope;
  assert.equal(envelope.payloadType, 'application/vnd.in-toto+json');
  return JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8')) as Statement;
}

/**
 * Accepts only HTTPS npm attestation discovery and refuses redirects to an arbitrary host.
 */
async function registryJson(url: string): Promise<unknown> {
  const target = new URL(url);
  assert.equal(target.origin, 'https://registry.npmjs.org');
  const response = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  assert.ok(response.ok, `Registry response ${response.status}`);
  const bytes = await response.text();
  assert.ok(bytes.length < 8 * 1024 * 1024, 'Registry response too large');
  return JSON.parse(bytes) as unknown;
}

/**
 * Requires the intended channel and preserves the initial placeholder policy for newly introduced
 * 1.0 packages.
 */
export function verifyTags(
  name: string,
  version: string,
  tags: Readonly<Record<string, string>>,
): void {
  assert.equal(tags[channel(version)], version, 'Release channel differs');
  if (channel(version) === 'next') {
    const latest = tags.latest;
    assert.ok(latest && latest !== version, 'RC must not move latest');
    if (latest !== '0.0.0-placeholder') {
      assert.equal(channel(latest), 'latest', 'latest cannot select an RC');
    }

    const existing = ['jwt-verifier', 'cloudflare', 'netlify', 'next'].map(
      (suffix) => `@serverless-jwt/${suffix}`,
    );
    if (version.startsWith('1.0.0-rc.') && !existing.includes(name)) {
      assert.equal(
        latest,
        '0.0.0-placeholder',
        'New-package latest must retain deprecated placeholder',
      );
      assert.equal(tags.bootstrap, '0.0.0-placeholder', 'Missing new-package bootstrap tag');
    }
  }
}

/**
 * Verifies every exact published version, channel and source identity, then runs npm's
 * cryptographic audit.
 */
export async function verifyPublished(directory: string, sourceRoot: string = root): Promise<void> {
  const packages = publicPackages(sourceRoot);
  checkDirectory(directory, packages);
  using temporary = mkdtempDisposableSync(join(tmpdir(), 'jwt-signatures-'));
  const config = join(temporary.path, 'empty.npmrc');
  writeFileSync(config, '', { flag: 'wx' });
  const env = npmEnvironment(config);
  for (const { manifest, filename } of packages) {
    const metadata = (await registryJson(
      `https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${manifest.version}`,
    )) as {
      readonly dist: {
        readonly integrity: string;
        readonly attestations: { readonly url: string };
      };
    };
    const bytes = readFileSync(resolve(directory, filename));
    assert.equal(metadata.dist.integrity, `sha512-${digest(bytes, 'sha512', 'base64')}`);
    const bundle = (await registryJson(metadata.dist.attestations.url)) as Parameters<
      typeof statementFromBundle
    >[0];
    verifyStatement(
      statementFromBundle(bundle),
      manifest.name,
      manifest.version,
      digest(bytes, 'sha512'),
    );
    const tags = (await registryJson(
      `https://registry.npmjs.org/-/package/${encodeURIComponent(manifest.name)}/dist-tags`,
    )) as Record<string, string>;
    verifyTags(manifest.name, manifest.version, tags);
  }

  const dependencies = Object.fromEntries(
    packages.map(({ manifest }) => [manifest.name, manifest.version]),
  );
  writeFileSync(
    join(temporary.path, 'package.json'),
    `${JSON.stringify({ name: 'release-signature-consumer', private: true, dependencies })}\n`,
  );
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--registry=https://registry.npmjs.org/',
    ],
    { cwd: temporary.path, env, stdio: 'inherit', timeout: 180_000 },
  );
  execFileSync('npm', ['audit', 'signatures', '--registry=https://registry.npmjs.org/'], {
    cwd: temporary.path,
    env,
    stdio: 'inherit',
    timeout: 180_000,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyPublished(process.argv[2] ?? '');
}
