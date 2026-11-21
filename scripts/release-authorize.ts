import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempDisposableSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { checkArchive } from './release-artifact-check.ts';
import { command, root } from './release-common.ts';
import { verifyRelease } from './release-verify.ts';

/**
 * Only the exact publish workflow and the current repository's successful build can authorize
 * bytes.
 */
export interface SourceRun {
  /**
   * Immutable GitHub API identity, never inferred from a display name.
   */
  readonly id: number;

  /**
   * Repository name and numeric identity owning the source workflow run.
   */
  readonly repository: { readonly full_name: string; readonly id: number };

  /**
   * Source repository identity rejects fork-origin artifacts.
   */
  readonly head_repository: { readonly full_name: string; readonly id: number };

  /**
   * Exact workflow path must be the reviewed publish workflow.
   */
  readonly path: string;

  /**
   * Immutable source commit must match the current checked-out tag.
   */
  readonly head_sha: string;

  /**
   * GitHub reports a bare tag for release runs; full tag refs are also accepted exactly.
   */
  readonly head_branch: string;

  /**
   * Only release and explicit workflow dispatch may supply publication artifacts.
   */
  readonly event: string;
}

/**
 * GitHub's immutable artifact identity and digest are carried separately from untrusted checksum
 * files.
 */
export interface Artifact {
  /**
   * Immutable GitHub API identity, never inferred from a display name.
   */
  readonly id: number;

  /**
   * Only the unique release-packages artifact is authorized.
   */
  readonly name: string;

  /**
   * Expired retained artifacts cannot support a resumed release.
   */
  readonly expired: boolean;

  /**
   * API-reported archive SHA256 binds downloaded bytes to the authorized artifact.
   */
  readonly digest: string;

  /**
   * Artifact association must identify the exact authorized run and commit.
   */
  readonly workflow_run: { readonly id: number; readonly head_sha: string };
}

/**
 * Checks recorded/API origin and requires exactly one successful, nonmatrix build job.
 */
export function authorizeOrigin(
  run: SourceRun,
  jobs: ReadonlyArray<{ readonly name: string; readonly conclusion: string }>,
  artifacts: ReadonlyArray<Artifact>,
  runId: number,
  repositoryId: number,
): { readonly artifact: Artifact; readonly event: 'release' | 'workflow_dispatch' } {
  assert.equal(run.id, runId);
  assert.equal(run.repository.full_name, process.env.GITHUB_REPOSITORY);
  assert.equal(run.repository.id, repositoryId);
  assert.equal(run.head_repository.full_name, process.env.GITHUB_REPOSITORY);
  assert.equal(run.head_repository.id, repositoryId);
  assert.equal(run.path, '.github/workflows/publish.yml');
  assert.equal(run.head_sha, process.env.GITHUB_SHA);
  const tag = process.env.GITHUB_REF?.replace(/^refs\/tags\//, '');
  assert.ok(tag && tag !== process.env.GITHUB_REF, 'Current ref must be a tag');
  assert.ok(
    run.head_branch === tag || run.head_branch === `refs/tags/${tag}`,
    'Source tag differs',
  );
  assert.ok(
    run.event === 'release' || run.event === 'workflow_dispatch',
    'Source event cannot publish',
  );
  const builds = jobs.filter(({ name }) => name === 'build');
  assert.equal(builds.length, 1, 'Exactly one build job required');
  assert.equal(builds[0]?.conclusion, 'success', 'Source build did not succeed');
  const matches = artifacts.filter(({ name }) => name === 'release-packages');
  assert.equal(matches.length, 1, 'Exactly one release-packages artifact required');
  const artifact = matches[0];
  assert.ok(artifact);
  assert.equal(artifact.expired, false, 'Artifact expired');
  assert.ok(Number.isSafeInteger(artifact.id) && artifact.id > 0);
  assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(artifact.workflow_run.id, runId);
  assert.equal(artifact.workflow_run.head_sha, process.env.GITHUB_SHA);
  return { artifact, event: run.event };
}

/**
 * Retrieves bounded API collections; pagination ambiguity fails closed rather than authorizing a
 * partial list.
 */
function collection<T>(endpoint: string, key: string): ReadonlyArray<T> {
  const response = JSON.parse(command('gh', ['api', `${endpoint}?per_page=100`])) as Record<
    string,
    unknown
  >;
  const list = response[key] as ReadonlyArray<T>;
  assert.ok(Array.isArray(list));
  assert.equal(response.total_count, list.length, 'API collection truncated');
  return list;
}

/**
 * Runs on every attempt, including resume; authorizes origin and actual archive inventory before
 * emitting outputs.
 */
export function authorizeRelease(sourceRoot: string = root): void {
  verifyRelease(sourceRoot);
  const source = process.env.RESUME_RUN_ID || process.env.GITHUB_RUN_ID || '';
  assert.match(source, /^[1-9][0-9]*$/);
  const runId = Number(source);
  assert.ok(Number.isSafeInteger(runId));
  const base = `repos/${process.env.GITHUB_REPOSITORY}`;
  const repository = JSON.parse(command('gh', ['api', base])) as { readonly id: number };
  const run = JSON.parse(command('gh', ['api', `${base}/actions/runs/${source}`])) as SourceRun;
  const jobs = collection<{ readonly name: string; readonly conclusion: string }>(
    `${base}/actions/runs/${source}/jobs`,
    'jobs',
  );
  const artifacts = collection<Artifact>(`${base}/actions/runs/${source}/artifacts`, 'artifacts');
  const { artifact, event } = authorizeOrigin(run, jobs, artifacts, runId, repository.id);
  using temporary = mkdtempDisposableSync(join(tmpdir(), 'jwt-authorize-'));
  const archive = join(temporary.path, 'artifact.zip');
  const bytes = execFileSync('gh', ['api', `${base}/actions/artifacts/${artifact.id}/zip`], {
    timeout: 180_000,
    maxBuffer: 256 * 1024 * 1024,
  });
  writeFileSync(archive, bytes, { flag: 'wx' });
  checkArchive(archive, artifact.digest, join(temporary.path, 'packages'), sourceRoot);
  assert.ok(process.env.GITHUB_OUTPUT, 'Missing workflow output file');
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `artifact-id=${artifact.id}\nartifact-digest=${artifact.digest}\nsource-run-id=${source}\nsource-event=${event}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  authorizeRelease();
}
