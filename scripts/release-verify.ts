import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import type { PublicPackage } from './release-common.ts';

import { channel, command, publicPackages, repositoryUrl, root } from './release-common.ts';

/**
 * Revalidates the current immutable tag and successful master push CI before any authorization.
 */
export function verifyRelease(directory: string = root): ReadonlyArray<PublicPackage> {
  const packages = publicPackages(directory);
  const first = packages[0];
  assert.ok(first);
  const version = first.manifest.version;
  const repository = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  assert.ok(repository && sha);
  assert.equal(
    `git+https://github.com/${repository}.git`,
    repositoryUrl,
    'Release repository differs from canonical upstream',
  );
  const tag = `v${version}`;
  assert.equal(process.env.GITHUB_REF, `refs/tags/${tag}`, 'Release ref differs from version');
  assert.match(process.env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
  assert.match(process.env.GITHUB_REPOSITORY ?? '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.ok(
    ['release', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME ?? ''),
    'Untrusted release event',
  );
  assert.equal(
    command('git', ['rev-parse', 'HEAD'], directory),
    process.env.GITHUB_SHA,
    'Checkout differs from event',
  );
  assert.equal(
    command('git', ['rev-parse', `${tag}^{commit}`], directory),
    process.env.GITHUB_SHA,
    'Tag differs from HEAD',
  );
  command('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/master'], directory);
  if (process.env.GITHUB_EVENT_NAME === 'release') {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    assert.ok(eventPath);
    const event = JSON.parse(readFileSync(eventPath, 'utf8')) as {
      release: { readonly prerelease: boolean; readonly tag_name: string; readonly draft: boolean };
    };
    assert.equal(event.release.tag_name, tag);
    assert.equal(event.release.draft, false);
    assert.equal(
      event.release.prerelease,
      channel(version) === 'next',
      'Release prerelease metadata differs',
    );
  }

  const names = new Set(packages.map(({ manifest }) => manifest.name));
  for (const { manifest } of packages) {
    for (const section of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
      'devDependencies',
    ] as const) {
      for (const [name, value] of Object.entries(manifest[section] ?? {})) {
        if (name.startsWith('@serverless-jwt/')) {
          assert.ok(names.has(name), 'Unknown internal dependency');
          assert.equal(value, 'workspace:*', 'Internal dependency must use workspace:*');
        }
      }
    }
  }

  const runs = JSON.parse(
    command(
      'gh',
      [
        'run',
        'list',
        '--repo',
        repository,
        '--workflow',
        'ci.yml',
        '--branch',
        'master',
        '--commit',
        sha,
        '--event',
        'push',
        '--status',
        'success',
        '--json',
        'headSha,event,conclusion,headBranch,workflowName',
      ],
      directory,
    ),
  ) as ReadonlyArray<{
    readonly headSha: string;
    readonly event: string;
    readonly conclusion: string;
    readonly headBranch: string;
  }>;
  assert.ok(
    runs.some(
      (run) =>
        run.headSha === process.env.GITHUB_SHA &&
        run.event === 'push' &&
        run.conclusion === 'success' &&
        run.headBranch === 'master',
    ),
    'No successful master push CI for this commit',
  );
  return packages;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyRelease();
}
