import {
  chmodSync,
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { parse } from 'yaml';

import { checkNeeds } from './ci-ok.ts';
import { checkTitle } from './pr-title.ts';
import { publishAll } from './publish-all.ts';
import { readArchive } from './release-artifact-check.ts';
import { attachRelease } from './release-attach.ts';
import { authorizeOrigin, authorizeRelease } from './release-authorize.ts';
import {
  channel,
  checkDirectory,
  digest,
  npmEnvironment,
  publicPackages,
} from './release-common.ts';
import { validateNpmArchive } from './release-npm-archive.ts';
import { verifyRelease } from './release-verify.ts';
import { setVersion } from './set-version.ts';
import {
  statementFromBundle,
  verifyStatement,
  verifyPublished,
  verifyTags,
} from './verify-published.ts';

/**
 * Restores inherited process configuration after every controlled command fixture.
 */
const originalEnvironment = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, originalEnvironment);
});

/**
 * Creates actual disposable source/artifact files without any Git mutation or registry write.
 */
function fixture(path, count = 2) {
  mkdirSync(join(path, 'packages'));
  const names = [
    'jwt-verifier',
    ...Array.from({ length: count - 1 }, (_, index) => `adapter-${index}`),
  ];
  for (const name of names) {
    mkdirSync(join(path, 'packages', name));
    writeFileSync(
      join(path, 'packages', name, 'package.json'),
      JSON.stringify({
        name: `@serverless-jwt/${name}`,
        version: '1.0.0-rc.1',
        repository: {
          url: 'git+https://github.com/sandrinodm/serverless-jwt.git',
          directory: `packages/${name}`,
        },
      }),
    );
  }

  const directory = join(path, 'artifacts');
  mkdirSync(directory);
  for (const { filename } of publicPackages(path)) {
    writeFileSync(join(directory, filename), `exact ${filename}`);
  }

  writeFileSync(
    join(directory, 'SHA512SUMS'),
    publicPackages(path)
      .map(
        ({ filename }) =>
          `${digest(readFileSync(join(directory, filename)), 'sha512')}  ${filename}\n`,
      )
      .join(''),
  );
  return directory;
}

/**
 * Runs controlled child commands while retaining Vitest's environment restoration.
 */
function fakeCommands(path, commands) {
  const bin = join(path, 'bin');
  mkdirSync(bin);
  for (const [name, body] of Object.entries(commands)) {
    const script = join(bin, name);
    writeFileSync(script, `#!${process.execPath}\n${body}`);
    chmodSync(script, 0o700);
  }

  process.env.PATH = `${bin}:${process.env.PATH}`;
}

/**
 * Constructs a real stored ZIP structure to exercise the production built-in parser.
 */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [filename, data] of entries) {
    const name = Buffer.from(filename);
    const bytes = Buffer.from(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, bytes);
    centrals.push(central, name);
    offset += local.length + name.length + bytes.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/**
 * Binds all origin fixtures to an explicit current tag and immutable commit.
 */
function identity() {
  process.env.GITHUB_REPOSITORY = 'sandrinodm/serverless-jwt';
  process.env.GITHUB_SHA = 'a'.repeat(40);
  process.env.GITHUB_REF = 'refs/tags/v1.0.0-rc.1';
  process.env.GITHUB_EVENT_NAME = 'workflow_dispatch';
  return {
    run: {
      id: 17,
      repository: { full_name: 'sandrinodm/serverless-jwt', id: 99 },
      head_repository: { full_name: 'sandrinodm/serverless-jwt', id: 99 },
      path: '.github/workflows/publish.yml',
      head_sha: 'a'.repeat(40),
      head_branch: 'v1.0.0-rc.1',
      event: 'release',
    },
    jobs: [{ name: 'build', conclusion: 'success' }],
    artifacts: [
      {
        id: 19,
        name: 'release-packages',
        expired: false,
        digest: `sha256:${'b'.repeat(64)}`,
        workflow_run: { id: 17, head_sha: 'a'.repeat(40) },
      },
    ],
  };
}

/**
 * Models GitHub's release, binary download and append-only upload endpoints.
 */
function releaseAssets(assets, status = 200) {
  process.env.GH_TOKEN = 'fixture-gh-token';
  process.env.RELEASE_SOURCE_EVENT ??= 'workflow_dispatch';
  const uploads = [];
  const downloads = [];
  const fetch = vi.fn(async (url, request) => {
    expect(request.headers.get('authorization')).toBe('Bearer fixture-gh-token');
    const endpoint = new URL(url);
    const path = endpoint.pathname;
    if (endpoint.host === 'uploads.github.com') {
      expect(path).toBe('/repos/sandrinodm/serverless-jwt/releases/13/assets');
      expect(request.method).toBe('POST');
      expect(request.headers.get('content-type')).toBe('application/octet-stream');
      const name = endpoint.searchParams.get('name');
      expect(assets.has(name)).toBe(false);
      assets.set(name, request.body);
      uploads.push(name);
      return new Response(null, { status: 201 });
    }

    expect(endpoint.host).toBe('api.github.com');
    if (path.endsWith('/tags/v1.0.0-rc.1')) {
      return Response.json(
        { id: 13, tag_name: 'v1.0.0-rc.1', draft: false, prerelease: true },
        { status },
      );
    }

    if (path.endsWith('/13/assets')) {
      const pageSize = Number(endpoint.searchParams.get('per_page'));
      const start = (Number(endpoint.searchParams.get('page')) - 1) * pageSize;
      return Response.json(
        [...assets].slice(start, start + pageSize).map(([name, bytes], index) => ({
          id: start + index + 1,
          name,
          size: bytes.length,
          state: 'uploaded',
        })),
      );
    }

    const id = Number(path.split('/').at(-1));
    const [name, bytes] = [...assets][id - 1];
    expect(request.headers.get('accept')).toBe('application/octet-stream');
    expect(request.redirect).toBe('follow');
    downloads.push(name);
    return new Response(bytes);
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, uploads, downloads };
}

describe('GitHub release attachment recovery', () => {
  it('matches present assets byte-for-byte and uploads only missing exact bytes', async () => {
    using temp = mkdtempDisposableSync(join(tmpdir(), 'release-attach-'));
    identity();
    const directory = fixture(temp.path);
    const names = publicPackages(temp.path).map(({ filename }) => filename);
    const assets = new Map([
      ['a-maintainer-note.txt', Buffer.from('manually attached note')],
      [names[0], readFileSync(join(directory, names[0]))],
    ]);
    const remote = releaseAssets(assets);
    await attachRelease(directory, temp.path);
    expect(remote.downloads).toEqual([names[0]]);
    expect(remote.uploads).toEqual([names[1], 'SHA512SUMS']);
    for (const name of [...names, 'SHA512SUMS']) {
      expect(assets.get(name)).toEqual(readFileSync(join(directory, name)));
    }

    remote.uploads.length = 0;
    remote.downloads.length = 0;
    await attachRelease(directory, temp.path);
    expect(remote.downloads).toEqual([...names, 'SHA512SUMS']);
    expect(remote.uploads).toEqual([]);
  });

  it('rejects a same-size conflict on a later page before uploading any missing asset', async () => {
    using temp = mkdtempDisposableSync(join(tmpdir(), 'release-attach-'));
    identity();
    const directory = fixture(temp.path);
    const name = 'SHA512SUMS';
    const bytes = readFileSync(join(directory, name));
    bytes[0] ^= 0xff;
    const unrelated = Array.from({ length: 100 }, (_, index) => [
      `note-${index}.txt`,
      Buffer.alloc(0),
    ]);
    const remote = releaseAssets(new Map([...unrelated, [name, bytes]]));
    await expect(attachRelease(directory, temp.path)).rejects.toThrow('Conflicting release asset');
    expect(remote.downloads).toEqual([name]);
    expect(remote.uploads).toEqual([]);
  });

  it('allows a tag-only dispatch and requires a release when either event is release', async () => {
    using temp = mkdtempDisposableSync(join(tmpdir(), 'release-attach-'));
    identity();
    const directory = fixture(temp.path);
    const missing = releaseAssets(new Map(), 404);
    await attachRelease(directory, temp.path);
    expect(missing.fetch).toHaveBeenCalledTimes(1);
    process.env.RELEASE_SOURCE_EVENT = 'release';
    await expect(attachRelease(directory, temp.path)).rejects.toThrow('Cannot look up');
    process.env.RELEASE_SOURCE_EVENT = 'workflow_dispatch';
    process.env.GITHUB_EVENT_NAME = 'release';
    await expect(attachRelease(directory, temp.path)).rejects.toThrow('Cannot look up');
    process.env.GITHUB_EVENT_NAME = 'workflow_dispatch';
    releaseAssets(new Map(), 403);
    await expect(attachRelease(directory, temp.path)).rejects.toThrow('Cannot look up');
  });

  it('reconciles after registry verification on release events and non-dry resumes', () => {
    const workflow = parse(
      readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8'),
    );
    const { steps } = workflow.jobs.publish;
    const verify = steps.findIndex((step) => step.run?.includes('verify-published.ts'));
    const attach = steps.findIndex((step) => step.run?.includes('release-attach.ts'));
    expect(verify).toBeGreaterThanOrEqual(0);
    expect(attach).toBeGreaterThan(verify);
    expect(steps[attach].if).toBe(
      "github.event_name == 'release' || (!inputs.dry-run && inputs.resume-run-id != '')",
    );
    expect(steps[attach].env.RELEASE_SOURCE_EVENT).toBe(
      '${{ needs.authorize.outputs.source-event }}',
    );
    expect(workflow.jobs.authorize.outputs['source-event']).toBe(
      '${{ steps.verify.outputs.source-event }}',
    );
  });
});

/**
 * Uses npm's actual SLSA v1 shape, including percent-encoded scoped package names.
 */
function statement() {
  identity();
  return {
    _type: 'https://in-toto.io/Statement/v1',
    predicateType: 'https://slsa.dev/provenance/v1',
    subject: [
      {
        name: 'pkg:npm/%40serverless-jwt/jwt-verifier@1.0.0-rc.1',
        digest: { sha512: 'c'.repeat(128) },
      },
    ],
    predicate: {
      buildDefinition: {
        buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
        externalParameters: {
          workflow: {
            repository: 'https://github.com/sandrinodm/serverless-jwt',
            path: '.github/workflows/publish.yml',
            ref: 'refs/tags/v1.0.0-rc.1',
          },
        },
        resolvedDependencies: [
          {
            uri: 'git+https://github.com/sandrinodm/serverless-jwt@refs/tags/v1.0.0-rc.1',
            digest: { gitCommit: 'a'.repeat(40) },
          },
        ],
      },
    },
  };
}

describe('release inventory and preparation', () => {
  it.each(['1.2.3', '0.0.0', '1.0.0-rc.0'])('accepts canonical %s', (value) =>
    expect(channel(value)).toBe(value.includes('-') ? 'next' : 'latest'),
  );
  it.each(['01.0.0', '1.0.0-beta.1', '1.0.0+build', '1.0', 'v1.0.0', '1.0.0-rc.01', '1.0.0\n'])(
    'rejects unsupported %s',
    (value) => expect(() => channel(value)).toThrow(),
  );
  it('discovers actual manifests and versions every public manifest from a clean tree', () => {
    using temp = mkdtempDisposableSync(join(tmpdir(), 'release-fixture-'));
    fixture(temp.path);
    fakeCommands(temp.path, { git: 'process.stdout.write(process.env.FAKE_DIRTY ?? "")' });
    setVersion('2.0.0', temp.path);
    expect(publicPackages(temp.path).map(({ manifest }) => manifest.version)).toEqual([
      '2.0.0',
      '2.0.0',
    ]);
    process.env.FAKE_DIRTY = '?? untracked';
    expect(() => setVersion('3.0.0', temp.path)).toThrow('dirty');
    expect(publicPackages(temp.path)[0].manifest.version).toBe('2.0.0');
  });
  it('rejects mismatched public versions before changing files', () => {
    using temp = mkdtempDisposableSync(join(tmpdir(), 'release-fixture-'));
    fixture(temp.path);
    const file = join(temp.path, 'packages/adapter-0/package.json');
    writeFileSync(
      file,
      JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), version: '2.0.0' }),
    );
    expect(() => publicPackages(temp.path)).toThrow('Mixed');
  });
});

describe('release current-ref checks with controlled git/gh', () => {
  it('checks exact tag, ancestry, master push CI and internal dependencies', () => {
    identity();
    using temp = mkdtempDisposableSync(join(tmpdir(), 'release-fixture-'));
    fixture(temp.path);
    fakeCommands(temp.path, {
      git: `if(process.argv[2]==='rev-parse') console.log(process.env.GITHUB_SHA); if(process.argv[2]==='merge-base'&&process.env.BAD_ANCESTRY)process.exit(1);`,
      gh: `console.log(JSON.stringify(process.env.NO_CI ? [] : [{headSha:process.env.GITHUB_SHA,event:'push',headBranch:'master',conclusion:'success'}]))`,
    });
    expect(verifyRelease(temp.path)).toHaveLength(2);
    process.env.GITHUB_REF = 'refs/heads/master';
    expect(() => verifyRelease(temp.path)).toThrow();
    identity();
    process.env.BAD_ANCESTRY = '1';
    expect(() => verifyRelease(temp.path)).toThrow();
    delete process.env.BAD_ANCESTRY;
    process.env.NO_CI = '1';
    expect(() => verifyRelease(temp.path)).toThrow('No successful');
    delete process.env.NO_CI;
    const file = join(temp.path, 'packages/adapter-0/package.json');
    writeFileSync(
      file,
      JSON.stringify({
        ...JSON.parse(readFileSync(file, 'utf8')),
        dependencies: { '@serverless-jwt/jwt-verifier': '^1.0.0' },
      }),
    );
    expect(() => verifyRelease(temp.path)).toThrow('workspace:*');
  });
  it('rejects release channel metadata disagreement', () => {
    identity();
    using temp = mkdtempDisposableSync(join(tmpdir(), 'release-fixture-'));
    fixture(temp.path);
    fakeCommands(temp.path, {
      git: `if(process.argv[2]==='rev-parse')console.log(process.env.GITHUB_SHA)`,
    });
    process.env.GITHUB_EVENT_NAME = 'release';
    process.env.GITHUB_EVENT_PATH = join(temp.path, 'event.json');
    writeFileSync(
      process.env.GITHUB_EVENT_PATH,
      JSON.stringify({ release: { prerelease: false, draft: false, tag_name: 'v1.0.0-rc.1' } }),
    );
    expect(() => verifyRelease(temp.path)).toThrow('metadata');
  });
});

describe('resume origin authorization', () => {
  it('accepts API bare-tag and full-tag representations', () => {
    const f = identity();
    expect(authorizeOrigin(f.run, f.jobs, f.artifacts, 17, 99).artifact.id).toBe(19);
    f.run.head_branch = process.env.GITHUB_REF;
    expect(authorizeOrigin(f.run, f.jobs, f.artifacts, 17, 99).artifact.id).toBe(19);
  });
  it.each([
    [
      'PR event',
      (f) => {
        f.run.event = 'pull_request';
      },
    ],
    [
      'different commit',
      (f) => {
        f.run.head_sha = 'd'.repeat(40);
      },
    ],
    [
      'different workflow',
      (f) => {
        f.run.path = '.github/workflows/ci.yml';
      },
    ],
    [
      'failed build',
      (f) => {
        f.jobs[0].conclusion = 'failure';
      },
    ],
    [
      'cancelled build',
      (f) => {
        f.jobs[0].conclusion = 'cancelled';
      },
    ],
    [
      'skipped build',
      (f) => {
        f.jobs[0].conclusion = 'skipped';
      },
    ],
    [
      'missing build',
      (f) => {
        f.jobs.length = 0;
      },
    ],
    [
      'expired artifact',
      (f) => {
        f.artifacts[0].expired = true;
      },
    ],
    [
      'duplicate artifact',
      (f) => {
        f.artifacts.push(f.artifacts[0]);
      },
    ],
    [
      'missing artifact',
      (f) => {
        f.artifacts.length = 0;
      },
    ],
    [
      'foreign repository',
      (f) => {
        f.run.repository.full_name = 'other/repo';
      },
    ],
    [
      'fork head',
      (f) => {
        f.run.head_repository.id = 100;
      },
    ],
    [
      'different tag',
      (f) => {
        f.run.head_branch = 'v2.0.0';
      },
    ],
    [
      'different run',
      (f) => {
        f.artifacts[0].workflow_run.id = 18;
      },
    ],
    [
      'missing digest',
      (f) => {
        f.artifacts[0].digest = '';
      },
    ],
  ])('rejects %s', (_, corrupt) => {
    const f = identity();
    corrupt(f);
    expect(() => authorizeOrigin(f.run, f.jobs, f.artifacts, 17, 99)).toThrow();
  });
});

describe('exact artifact bytes', () => {
  it('rejects tamper, missing/extra tarballs, duplicate checksums and symlinks', () => {
    using temp = mkdtempDisposableSync(join(tmpdir(), 'release-fixture-'));
    const dir = fixture(temp.path);
    checkDirectory(dir, publicPackages(temp.path));
    const first = publicPackages(temp.path)[0].filename;
    writeFileSync(join(dir, first), 'tamper');
    expect(() => checkDirectory(dir, publicPackages(temp.path))).toThrow('checksum');
    writeFileSync(join(dir, 'extra.tgz'), 'extra');
    expect(() => checkDirectory(dir, publicPackages(temp.path))).toThrow('inventory');
  });
  it.each([
    ['missing file', [['a.tgz', 'a']]],
    [
      'extra file',
      [
        ['a.tgz', 'a'],
        ['SHA512SUMS', 's'],
        ['b.tgz', 'b'],
      ],
    ],
    [
      'traversal',
      [
        ['../a.tgz', 'a'],
        ['SHA512SUMS', 's'],
      ],
    ],
    [
      'duplicate',
      [
        ['a.tgz', 'a'],
        ['a.tgz', 'b'],
      ],
    ],
  ])('rejects archive %s', (_, entries) => {
    const bytes = zip(entries);
    expect(() =>
      readArchive(bytes, `sha256:${digest(bytes, 'sha256')}`, ['a.tgz', 'SHA512SUMS']),
    ).toThrow();
  });
  it('checks API SHA256 before parsing the archive', () => {
    const bytes = zip([
      ['a.tgz', 'a'],
      ['SHA512SUMS', 's'],
    ]);
    expect([
      ...readArchive(bytes, `sha256:${digest(bytes, 'sha256')}`, ['a.tgz', 'SHA512SUMS']).keys(),
    ]).toEqual(['a.tgz', 'SHA512SUMS']);
    expect(() => readArchive(Buffer.from('not zip'), `sha256:${'f'.repeat(64)}`, [])).toThrow(
      'digest',
    );
  });
});

describe('idempotent minimal publisher with fake npm', () => {
  it('dry run invokes no npm command and performs no registry writes', () => {
    using temp = mkdtempDisposableSync(join(tmpdir(), 'release-fixture-'));
    const dir = fixture(temp.path);
    fakeCommands(temp.path, { npm: 'process.exit(99)' });
    expect(() => publishAll(dir, true, temp.path)).not.toThrow();
  });
  it('publishes core first, keeps flags and clean credentials, and resumes identical bytes', () => {
    using temp = mkdtempDisposableSync(join(tmpdir(), 'release-fixture-'));
    const dir = fixture(temp.path);
    process.env.NPM_TEST_LOG = join(temp.path, 'npm.jsonl');
    process.env.NODE_AUTH_TOKEN = 'must-not-leak';
    process.env.NPM_TOKEN = 'must-not-leak';
    fakeCommands(temp.path, {
      npm: `const fs=require('node:fs'); const args=process.argv.slice(2); if(process.env.NODE_AUTH_TOKEN||process.env.NPM_TOKEN)process.exit(77); fs.appendFileSync(process.env.NPM_TEST_LOG,JSON.stringify(args)+'\\n'); if(args[0]==='view'){if(process.env.EXISTING)console.log(JSON.stringify(process.env.EXISTING));else{console.log(JSON.stringify({error:{code:'E404'}}));process.exit(1);}}`,
    });
    publishAll(dir, false, temp.path);
    const calls = readFileSync(process.env.NPM_TEST_LOG, 'utf8').trim().split('\n').map(JSON.parse);
    expect(calls[1][1]).toContain('jwt-verifier');
    expect(calls.filter(([action]) => action === 'publish')).toHaveLength(2);
    for (const args of calls.filter(([action]) => action === 'publish')) {
      expect(args).toContain('--provenance');
      expect(args).toContain('--ignore-scripts');
      expect(args).toContain('next');
      expect(args).not.toContain('--force');
    }

    process.env.EXISTING = 'sha512-conflicting';
    expect(() => publishAll(dir, false, temp.path)).toThrow('integrity differs');
  });
  it('preserves OIDC request credentials while removing inherited token/config variables', () => {
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'oidc';
    process.env.NODE_AUTH_TOKEN = 'bad';
    process.env.npm_config_registry = 'bad';
    process.env.NODE_OPTIONS = '--import=bad';
    const env = npmEnvironment('/tmp/empty');
    expect(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN).toBe('oidc');
    expect(env.NODE_AUTH_TOKEN).toBeUndefined();
    expect(env.npm_config_registry).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
  });
});

describe('published provenance identity', () => {
  it('decodes actual npm DSSE bundle shape and verifies all release identities', () => {
    const value = statement();
    const bundle = {
      attestations: [
        {
          predicateType: value.predicateType,
          bundle: {
            dsseEnvelope: {
              payloadType: 'application/vnd.in-toto+json',
              payload: Buffer.from(JSON.stringify(value)).toString('base64'),
            },
          },
        },
      ],
    };
    verifyStatement(
      statementFromBundle(bundle),
      '@serverless-jwt/jwt-verifier',
      '1.0.0-rc.1',
      'c'.repeat(128),
    );
  });
  it.each([
    [
      'subject',
      (s) => {
        s.subject[0].digest.sha512 = 'd'.repeat(128);
      },
    ],
    [
      'repository',
      (s) => {
        s.predicate.buildDefinition.externalParameters.workflow.repository =
          'https://github.com/attacker/repo';
      },
    ],
    [
      'workflow',
      (s) => {
        s.predicate.buildDefinition.externalParameters.workflow.path = '.github/workflows/ci.yml';
      },
    ],
    [
      'ref',
      (s) => {
        s.predicate.buildDefinition.externalParameters.workflow.ref = 'refs/heads/master';
      },
    ],
    [
      'commit',
      (s) => {
        s.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = 'd'.repeat(40);
      },
    ],
  ])('rejects wrong %s', (_, corrupt) => {
    const s = statement();
    corrupt(s);
    expect(() =>
      verifyStatement(s, '@serverless-jwt/jwt-verifier', '1.0.0-rc.1', 'c'.repeat(128)),
    ).toThrow();
  });
});

describe('required status aggregation', () => {
  it.each(['failure', 'cancelled', 'skipped', 'unknown'])('rejects %s prerequisite', (result) =>
    expect(() => checkNeeds({ test: { result } }, [])).toThrow(),
  );
  it('allows only explicitly permitted skips and rejects empty needs', () => {
    checkNeeds({ test: { result: 'success' }, nightly: { result: 'skipped' } }, ['nightly']);
    expect(() => checkNeeds({}, [])).toThrow();
  });
});

describe('strict file manifests and npm bootstrap archive controls', () => {
  it('rejects actual missing tarballs, duplicate checksum records and symlink entries', () => {
    using temp = mkdtempDisposableSync(join(tmpdir(), 'release-fixture-'));
    const dir = fixture(temp.path);
    const packages = publicPackages(temp.path);
    const sums = readFileSync(join(dir, 'SHA512SUMS'), 'utf8');
    writeFileSync(join(dir, 'SHA512SUMS'), sums + sums.split('\n')[0] + '\n');
    expect(() => checkDirectory(dir, packages)).toThrow('Duplicate');
    writeFileSync(join(dir, 'SHA512SUMS'), sums);
    const first = join(dir, packages[0].filename);
    rmSync(first);
    expect(() => checkDirectory(dir, packages)).toThrow('inventory');
    const outside = join(temp.path, 'outside');
    writeFileSync(outside, 'outside');
    symlinkSync(outside, first);
    expect(() => checkDirectory(dir, packages)).toThrow('regular file');
  });
  it('rejects bootstrap hash tampering before decompression', () => {
    expect(() => validateNpmArchive(Buffer.from('invalid archive'), 'sha512-wrong')).toThrow(
      'integrity',
    );
  });
  it.each(['package/../../escape', '/absolute', 'package/bin/npm-cli.js'])(
    'rejects unsafe npm archive %s',
    (name) => {
      const header = Buffer.alloc(512);
      header.write(name);
      header.write('00000000000\0', 124);
      header[156] = name === 'package/bin/npm-cli.js' ? 50 : 48;
      const bytes = gzipSync(Buffer.concat([header, Buffer.alloc(1024)]));
      expect(() =>
        validateNpmArchive(bytes, `sha512-${digest(bytes, 'sha512', 'base64')}`),
      ).toThrow();
    },
  );
});

describe('registry verification with controlled registry responses and fake npm', () => {
  it('installs only exact versions with scripts disabled and propagates signature-audit failure', async () => {
    using temp = mkdtempDisposableSync(join(tmpdir(), 'release-fixture-'));
    const dir = fixture(temp.path, 1);
    const value = statement();
    const bytes = readFileSync(join(dir, publicPackages(temp.path)[0].filename));
    const sha = digest(bytes, 'sha512');
    value.subject[0].digest.sha512 = sha;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      const body = url.includes('attestations')
        ? {
            attestations: [
              {
                predicateType: value.predicateType,
                bundle: {
                  dsseEnvelope: {
                    payloadType: 'application/vnd.in-toto+json',
                    payload: Buffer.from(JSON.stringify(value)).toString('base64'),
                  },
                },
              },
            ],
          }
        : url.includes('dist-tags')
          ? { next: '1.0.0-rc.1', latest: '0.0.0-placeholder' }
          : {
              dist: {
                integrity: `sha512-${digest(bytes, 'sha512', 'base64')}`,
                attestations: { url: 'https://registry.npmjs.org/attestations/test' },
              },
            };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    fakeCommands(temp.path, {
      npm: `const fs=require('node:fs'); const args=process.argv.slice(2); if(process.env.NODE_AUTH_TOKEN)process.exit(77); if(args[0]==='install'){const deps=JSON.parse(fs.readFileSync('package.json','utf8')).dependencies;if(JSON.stringify(deps)!==JSON.stringify({'@serverless-jwt/jwt-verifier':'1.0.0-rc.1'})||!args.includes('--ignore-scripts'))process.exit(78);}else if(args.join(' ').startsWith('audit signatures')){if(process.env.P7_FAIL_SIGNATURES)process.exit(42);}else process.exit(79);`,
    });
    await verifyPublished(dir, temp.path);
    process.env.P7_FAIL_SIGNATURES = '1';
    await expect(verifyPublished(dir, temp.path)).rejects.toThrow();
  });
});

it('decodes an actual recorded npm SLSA v1 response and rejects its unrelated source identity', () => {
  const bundle = JSON.parse(
    readFileSync(new URL('./fixtures/release-provenance.json', import.meta.url), 'utf8'),
  );
  const recorded = statementFromBundle(bundle);
  expect(recorded.subject[0].name).toBe('pkg:npm/vite-plus@1.5.0');
  expect(recorded.predicate.buildDefinition.externalParameters.workflow.repository).toBe(
    'https://github.com/voidzero-dev/vite-plus',
  );
  identity();
  expect(() =>
    verifyStatement(recorded, '@serverless-jwt/jwt-verifier', '1.0.0-rc.1', 'c'.repeat(128)),
  ).toThrow();
});

describe('release channel tag policy', () => {
  it('preserves initial new-package placeholders and existing-package stable tags', () => {
    verifyTags('@serverless-jwt/hono', '1.0.0-rc.1', {
      next: '1.0.0-rc.1',
      latest: '0.0.0-placeholder',
      bootstrap: '0.0.0-placeholder',
    });
    verifyTags('@serverless-jwt/jwt-verifier', '1.0.0-rc.1', {
      next: '1.0.0-rc.1',
      latest: '0.2.1',
    });
    verifyTags('@serverless-jwt/hono', '1.0.0', { latest: '1.0.0' });
    expect(() =>
      verifyTags('@serverless-jwt/hono', '1.0.0-rc.1', { next: '1.0.0-rc.1', latest: '0.2.1' }),
    ).toThrow('placeholder');
    expect(() =>
      verifyTags('@serverless-jwt/jwt-verifier', '1.0.0-rc.1', {
        next: '1.0.0-rc.1',
        latest: '1.0.0-rc.0',
      }),
    ).toThrow('RC');
    expect(() => verifyTags('@serverless-jwt/hono', '1.0.0', { latest: '0.2.1' })).toThrow(
      'channel',
    );
  });
  it('rejects non-semver oversized core numbers and oversized versions', () => {
    expect(() => channel('999999999999999999999.0.0')).toThrow('safe integer');
    expect(() => channel('1.0.0-rc.' + '9'.repeat(260))).toThrow('length');
  });
});

it('rechecks current tag and CI on resume before emitting any artifact authorization', () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), 'release-fixture-'));
  const dir = fixture(temp.path, 1);
  const source = identity();
  process.env.RESUME_RUN_ID = '17';
  process.env.GITHUB_RUN_ID = '18';
  process.env.GITHUB_OUTPUT = join(temp.path, 'outputs');
  const packages = publicPackages(temp.path);
  const bytes = zip([
    ...packages.map(({ filename }) => [filename, readFileSync(join(dir, filename))]),
    ['SHA512SUMS', readFileSync(join(dir, 'SHA512SUMS'))],
  ]);
  const archive = join(temp.path, 'archive.zip');
  writeFileSync(archive, bytes);
  source.artifacts[0].digest = `sha256:${digest(bytes, 'sha256')}`;
  process.env.P7_AUTH_FIXTURE = join(temp.path, 'recorded.json');
  writeFileSync(process.env.P7_AUTH_FIXTURE, JSON.stringify({ ...source, archive }));
  fakeCommands(temp.path, {
    git: `if(process.argv[2]==='rev-parse')console.log(process.env.GITHUB_SHA)`,
    gh: `const fs=require('node:fs');const f=JSON.parse(fs.readFileSync(process.env.P7_AUTH_FIXTURE));const args=process.argv.slice(2);if(args[0]==='run'){console.log(JSON.stringify(process.env.NO_CI?[]:[{headSha:process.env.GITHUB_SHA,event:'push',headBranch:'master',conclusion:'success'}]));}else{const endpoint=args[1];if(endpoint.endsWith('/zip'))process.stdout.write(fs.readFileSync(f.archive));else if(endpoint.includes('/jobs?'))console.log(JSON.stringify({total_count:f.jobs.length,jobs:f.jobs}));else if(endpoint.includes('/artifacts?'))console.log(JSON.stringify({total_count:f.artifacts.length,artifacts:f.artifacts}));else if(endpoint.includes('/actions/runs/'))console.log(JSON.stringify(f.run));else console.log(JSON.stringify({id:99}));}`,
  });
  authorizeRelease(temp.path);
  expect(readFileSync(process.env.GITHUB_OUTPUT, 'utf8')).toContain('artifact-id=19');
  expect(readFileSync(process.env.GITHUB_OUTPUT, 'utf8')).toContain(
    `source-event=${source.run.event}\n`,
  );
  rmSync(process.env.GITHUB_OUTPUT);
  process.env.NO_CI = '1';
  expect(() => authorizeRelease(temp.path)).toThrow('No successful');
  expect(() => readFileSync(process.env.GITHUB_OUTPUT)).toThrow();
  delete process.env.NO_CI;
  process.env.GITHUB_REF = 'refs/tags/v2.0.0';
  expect(() => authorizeRelease(temp.path)).toThrow('ref differs');
});

it('skips equal scalar/singleton integrity and rejects ambiguous registry answers and non-404 failures', () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), 'release-fixture-'));
  const dir = fixture(temp.path, 1);
  const filename = publicPackages(temp.path)[0].filename;
  process.env.P7_TEST_INTEGRITY = `sha512-${digest(readFileSync(join(dir, filename)), 'sha512', 'base64')}`;
  fakeCommands(temp.path, {
    npm: `if(process.argv[2]!=='view')process.exit(79);if(process.env.P7_REGISTRY_ERROR){console.log(JSON.stringify({error:{code:'E401'}}));process.exit(1);}const value=process.env.P7_TEST_INTEGRITY;console.log(JSON.stringify(process.env.P7_ARRAY==='two'?[value,value]:process.env.P7_ARRAY==='one'?[value]:value));`,
  });
  expect(() => publishAll(dir, false, temp.path)).not.toThrow();
  process.env.P7_ARRAY = 'one';
  expect(() => publishAll(dir, false, temp.path)).not.toThrow();
  process.env.P7_ARRAY = 'two';
  expect(() => publishAll(dir, false, temp.path)).toThrow('Ambiguous');
  process.env.P7_REGISTRY_ERROR = '1';
  expect(() => publishAll(dir, false, temp.path)).toThrow('Registry lookup failed');
});

it('checks PR title subjects with the same version-dot and trailing-period policy as commits', () => {
  expect(() => checkTitle('chore(release): prepare v1.0.0-rc.1')).not.toThrow();
  expect(() => checkTitle('fix: a')).not.toThrow();
  expect(() => checkTitle('fix: reject unsafe archives.')).toThrow();
  expect(() => checkTitle('fix: Reject unsafe archives')).toThrow();
  expect(() => checkTitle('fix: reject\nunsafe archives')).toThrow();
});

/**
 * Public manifest discovery accepts only the verified upstream identity used for provenance.
 */
it('accepts canonical repository metadata and rejects the stale upstream owner before release', () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), 'release-repository-'));
  fixture(temp.path, 1);
  const file = join(temp.path, 'packages/jwt-verifier/package.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  manifest.repository = {
    url: 'git+https://github.com/sandrinodm/serverless-jwt.git',
    directory: 'packages/jwt-verifier',
  };
  writeFileSync(file, JSON.stringify(manifest));
  expect(publicPackages(temp.path)).toHaveLength(1);
  identity();
  fakeCommands(temp.path, {
    git: `if(process.argv[2]==='rev-parse')console.log(process.env.GITHUB_SHA)`,
    gh: `console.log(JSON.stringify([{headSha:process.env.GITHUB_SHA,event:'push',headBranch:'master',conclusion:'success'}]))`,
  });
  expect(verifyRelease(temp.path)).toHaveLength(1);
  process.env.GITHUB_REPOSITORY = 'sandrinodimattia/serverless-jwt';
  expect(() => verifyRelease(temp.path)).toThrow(
    'Release repository differs from canonical upstream',
  );
  identity();
  manifest.repository.url = 'git+https://github.com/sandrinodimattia/serverless-jwt.git';
  writeFileSync(file, JSON.stringify(manifest));
  expect(() => publicPackages(temp.path)).toThrow('Repository URL differs from canonical upstream');
});

/**
 * Title-only edits must schedule the real blocking job and pass the current title via the
 * environment.
 */
it('refreshes blocking title validation on PR title edits', () => {
  const workflow = parse(
    readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'),
  );
  expect(workflow.on.pull_request.branches).toContain('master');
  expect(workflow.on.pull_request.types).toEqual(
    expect.arrayContaining(['opened', 'synchronize', 'reopened', 'edited']),
  );
  const titleStep = workflow.jobs.check.steps.find(
    (step) => step.run === 'node scripts/pr-title.ts',
  );
  expect(titleStep).toMatchObject({
    if: "github.event_name == 'pull_request'",
    env: { PR_TITLE: '${{ github.event.pull_request.title }}' },
  });
  expect(workflow.jobs['ci-ok'].needs).toContain('check');
  expect(() => checkTitle('fix: valid edited title')).not.toThrow();
  expect(() => checkTitle('invalid edited title')).toThrow();
  expect(() => checkNeeds({ check: { result: 'failure' } })).toThrow();
});

/**
 * Every actual public package must retain the canonical upstream identity before packing.
 */
it('uses canonical repository metadata in every actual public manifest', () => {
  const packages = publicPackages();
  expect(packages.length).toBeGreaterThan(0);
  for (const { manifest } of packages) {
    expect(manifest.repository.url).toBe('git+https://github.com/sandrinodm/serverless-jwt.git');
  }
});
