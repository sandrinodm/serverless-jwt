import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { channel, checkDirectory, publicPackages, repositoryUrl, root } from './release-common.ts';

/**
 * Sends bounded requests to the official release endpoints using the workflow token.
 */
function github(url: string, init: RequestInit = {}): Promise<Response> {
  const token = process.env.GH_TOKEN;
  assert.ok(token, 'Missing GitHub release token');
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (!headers.has('accept')) {
    headers.set('accept', 'application/vnd.github+json');
  }

  return fetch(url, {
    redirect: 'error',
    ...init,
    headers,
    signal: AbortSignal.timeout(60_000),
  });
}

/**
 * Reconciles an existing release with the precise tested artifact after registry verification.
 */
export async function attachRelease(directory: string, checkout: string = root): Promise<void> {
  const packages = publicPackages(checkout);
  const version = packages[0]?.manifest.version;
  assert.ok(version);
  const tag = `v${version}`;
  const repository = process.env.GITHUB_REPOSITORY;
  assert.equal(`git+https://github.com/${repository}.git`, repositoryUrl);
  assert.equal(process.env.GITHUB_REF, `refs/tags/${tag}`);
  const event = process.env.GITHUB_EVENT_NAME;
  assert.ok(event === 'release' || event === 'workflow_dispatch');
  const sourceEvent = process.env.RELEASE_SOURCE_EVENT;
  assert.ok(
    sourceEvent === 'release' || sourceEvent === 'workflow_dispatch',
    'Invalid authorized source event',
  );
  const filenames = checkDirectory(directory, packages);

  const api = `https://api.github.com/repos/${repository}/releases`;
  const response = await github(`${api}/tags/${tag}`);
  if (
    response.status === 404 &&
    event === 'workflow_dispatch' &&
    sourceEvent === 'workflow_dispatch'
  ) {
    return;
  }

  assert.equal(response.status, 200, 'Cannot look up the GitHub release for this tag');
  const release = (await response.json()) as {
    readonly id: number;
    readonly tag_name: string;
    readonly draft: boolean;
    readonly prerelease: boolean;
  };
  assert.ok(Number.isSafeInteger(release.id) && release.id > 0, 'Invalid GitHub release ID');
  assert.equal(release.tag_name, tag);
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, channel(version) === 'next');

  const expected = new Map(filenames.map((name) => [name, readFileSync(resolve(directory, name))]));
  const existing = new Set<string>();
  for (let page = 1; ; page++) {
    const listing = await github(`${api}/${release.id}/assets?per_page=100&page=${page}`);
    assert.equal(listing.status, 200, 'Cannot list GitHub release assets');
    const assets = (await listing.json()) as ReadonlyArray<{
      readonly id: number;
      readonly name: string;
      readonly state: string;
      readonly size: number;
    }>;
    assert.ok(Array.isArray(assets), 'Invalid GitHub release asset list');
    for (const { id, name, state, size } of assets) {
      const bytes = expected.get(name);
      if (bytes === undefined) {
        continue;
      }

      assert.ok(!existing.has(name), `Duplicate GitHub release asset ${name}`);
      assert.ok(Number.isSafeInteger(id) && id > 0, `Invalid GitHub release asset ID for ${name}`);
      assert.ok(state === 'uploaded' && size === bytes.length, `Conflicting release asset ${name}`);
      const download = await github(`${api}/assets/${id}`, {
        headers: { accept: 'application/octet-stream' },
        redirect: 'follow',
      });
      assert.equal(download.status, 200, `Cannot download GitHub release asset ${name}`);
      assert.ok(
        bytes.equals(Buffer.from(await download.arrayBuffer())),
        `Conflicting release asset ${name}`,
      );
      existing.add(name);
    }

    if (assets.length < 100) {
      break;
    }
  }

  for (const [name, bytes] of expected) {
    if (existing.has(name)) {
      continue;
    }

    const upload = await github(
      `https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
      { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes },
    );
    assert.equal(upload.status, 201, `Cannot upload GitHub release asset ${name}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2];
  assert.ok(directory, 'Missing authorized artifact directory');
  await attachRelease(directory);
}
