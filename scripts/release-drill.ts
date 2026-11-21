import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempDisposableSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { digest, root } from './release-common.ts';

/**
 * The local fixture registry is immutable, has no uplinks and is never a production publication
 * target.
 */
const image: string =
  'verdaccio/verdaccio@sha256:b31af41ced1bda71181ed5e27b047087ad48dd573a12e7af6e9ef3072ddf2b35';

/**
 * Evidence outlives the disposable registry; configuration and local credentials do not.
 */
const report: string = resolve(process.argv[2] ?? 'reports/release-drill');
mkdirSync(report, { recursive: true });

/**
 * Every mechanical fixture lives outside the checkout and is intentionally distinct from a real
 * package gate.
 */
using temporary = mkdtempDisposableSync(join(tmpdir(), 'jwt-release-drill-'));

/**
 * The pinned npm already installed by the frozen workspace is the measured publisher
 * implementation.
 */
const npm: string = resolve(root, 'node_modules/npm/bin/npm-cli.js');
assert.equal(
  JSON.parse(readFileSync(resolve(root, 'node_modules/npm/package.json'), 'utf8')).version,
  '12.2.1',
);

/**
 * A unique disposable container prevents collisions with another local rehearsal.
 */
const container: string = `jwt-release-drill-${process.pid}`;

/**
 * Mechanical names exercise fourteen-package ordering and retry without inventing product
 * implementation.
 */
const names: ReadonlyArray<string> = [
  'jwt-verifier',
  ...Array.from({ length: 13 }, (_, index) => `drill-${String(index + 1).padStart(2, '0')}`),
];

/**
 * Exact fixture integrity inventory is captured before any registry operation.
 */
const before: Record<string, string> = {};
mkdirSync(join(temporary.path, 'packages'));
mkdirSync(join(temporary.path, 'artifacts'));
mkdirSync(join(temporary.path, 'bin'));
for (const name of names) {
  const directory = join(temporary.path, 'packages', name);
  const stage = join(temporary.path, 'stage', name, 'package');
  mkdirSync(directory);
  mkdirSync(stage, { recursive: true });
  const manifest = {
    name: `@serverless-jwt/${name}`,
    version: '1.0.0-rc.1',
    description: 'Disposable local P7 mechanical fixture',
    repository: {
      url: 'git+https://github.com/sandrinodm/serverless-jwt.git',
      directory: `packages/${name}`,
    },
  };
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(stage, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(stage, 'README.md'), 'Disposable local release tooling fixture.\n');
  const filename = `serverless-jwt-${name}-1.0.0-rc.1.tgz`;
  const artifact = join(temporary.path, 'artifacts', filename);
  execFileSync('tar', ['-czf', artifact, '-C', resolve(stage, '..'), 'package']);
  before[filename] = digest(readFileSync(artifact), 'sha512');
}

writeFileSync(
  join(temporary.path, 'artifacts/SHA512SUMS'),
  Object.entries(before)
    .map(([name, hash]) => `${hash}  ${name}\n`)
    .join(''),
);
writeFileSync(
  join(temporary.path, 'config.yaml'),
  `storage: /verdaccio/storage
  auth:
    htpasswd:
      file: /verdaccio/storage/htpasswd
  uplinks: {}
  packages:
    '@serverless-jwt/*':
      access: $all
      publish: $all
      unpublish: $all
  log:
    type: stdout
    format: pretty
    level: warn
`.replace(/^  /gm, ''),
);
try {
  execFileSync(
    'docker',
    [
      'run',
      '-d',
      '--rm',
      '--name',
      container,
      '-p',
      '127.0.0.1::4873',
      '-v',
      `${join(temporary.path, 'config.yaml')}:/verdaccio/conf/config.yaml:ro`,
      image,
    ],
    { timeout: 30_000 },
  );
  const binding = execFileSync('docker', ['port', container, '4873/tcp'], {
    encoding: 'utf8',
  }).trim();
  assert.match(binding, /^127\.0\.0\.1:[0-9]+$/);
  const registry = `http://${binding}/`;
  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${registry}-/ping`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {
      /* A newly started isolated server may not yet be listening. */
    }

    await setTimeout(100);
  }

  assert.ok(healthy, 'Local registry did not start');
  const auth = await fetch(`${registry}-/user/org.couchdb.user:p7drill`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'p7drill',
      password: 'disposable-local-only',
      email: 'p7@example.invalid',
      type: 'user',
      roles: [],
    }),
  });
  assert.ok(auth.ok);
  const credentials = (await auth.json()) as { readonly token: string };
  assert.ok(credentials.token);
  writeFileSync(
    join(temporary.path, 'local.npmrc'),
    `//${binding}/:_authToken=${credentials.token}\n`,
    { mode: 0o600 },
  );
  // This executable is exclusively a disposable fixture transport. Production scripts retain all flags.
  const wrapper = `#!${process.execPath}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const base = ${JSON.stringify(temporary.path)};
if (process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN) process.exit(77);
if (!args.includes('--registry=https://registry.npmjs.org/')) process.exit(78);
const local = args.map(arg => arg === '--registry=https://registry.npmjs.org/' ? ${JSON.stringify(`--registry=${registry}`)} : arg);
if (process.env.DRILL_LOCAL_ADAPT === '1') {
  const index = local.indexOf('--provenance');
  if (index >= 0) local.splice(index, 1);
}
const count = fs.existsSync(base + '/count') ? Number(fs.readFileSync(base + '/count', 'utf8')) : 0;
if (args[0] === 'publish' && process.env.DRILL_FAIL_AFTER === '7' && count === 7) process.exit(42);
fs.appendFileSync(base + '/commands.jsonl', JSON.stringify({ args, adapted: process.env.DRILL_LOCAL_ADAPT === '1' }) + '\\n');
local.push('--userconfig=' + base + '/local.npmrc');
const result = spawnSync(process.execPath, [${JSON.stringify(npm)}, ...local], { stdio: 'inherit', env: process.env });
if (result.status === 0 && args[0] === 'publish') fs.writeFileSync(base + '/count', String(count + 1));
process.exit(result.status ?? 1);
`;
  writeFileSync(join(temporary.path, 'bin/npm'), wrapper, { mode: 0o700 });
  writeFileSync(
    join(temporary.path, 'run.ts'),
    `import { publishAll } from ${JSON.stringify(resolve(root, 'scripts/publish-all.ts'))};\npublishAll(${JSON.stringify(join(temporary.path, 'artifacts'))}, false, ${JSON.stringify(temporary.path)});\n`,
  );
  /**
   * Captures a bounded production-tool attempt without copying local fixture credentials into
   * evidence.
   */
  const execute = (
    name: string,
    extra: NodeJS.ProcessEnv,
  ): { readonly status: number | null; readonly output: string } => {
    const result = spawnSync(process.execPath, [join(temporary.path, 'run.ts')], {
      cwd: temporary.path,
      env: { ...process.env, PATH: `${join(temporary.path, 'bin')}:${process.env.PATH}`, ...extra },
      encoding: 'utf8',
      timeout: 180_000,
    });
    assert.ifError(result.error);
    const output = `${result.stdout}\n${result.stderr}`;
    writeFileSync(join(report, `${name}.log`), output);
    return { status: result.status, output };
  };
  const production = execute('production-provenance', {});
  assert.notEqual(production.status, 0);
  assert.match(production.output, /Automatic provenance generation not supported/);
  const partial = execute('partial-seven', { DRILL_LOCAL_ADAPT: '1', DRILL_FAIL_AFTER: '7' });
  assert.notEqual(partial.status, 0);
  assert.equal(readFileSync(join(temporary.path, 'count'), 'utf8'), '7');
  const resumed = execute('resume-identical', { DRILL_LOCAL_ADAPT: '1' });
  assert.equal(resumed.status, 0);
  assert.equal(resumed.output.split('\n').filter((line) => line.startsWith('skip ')).length, 7);
  assert.equal(readFileSync(join(temporary.path, 'count'), 'utf8'), '14');
  const idempotent = execute('resume-complete', { DRILL_LOCAL_ADAPT: '1' });
  assert.equal(idempotent.status, 0);
  assert.equal(idempotent.output.split('\n').filter((line) => line.startsWith('skip ')).length, 14);
  for (const [filename, hash] of Object.entries(before)) {
    assert.equal(digest(readFileSync(join(temporary.path, 'artifacts', filename)), 'sha512'), hash);
  }

  writeFileSync(
    join(report, 'commands.jsonl'),
    readFileSync(join(temporary.path, 'commands.jsonl')),
  );
  writeFileSync(
    join(report, 'result.json'),
    `${JSON.stringify(
      {
        image,
        npm: '12.2.1',
        fixturePackages: 14,
        productionProvenance: 'rejected: hosted identity unavailable',
        partialPublished: 7,
        resumedSkipped: 7,
        resumedPublished: 7,
        completeResumeSkipped: 14,
        unchangedArtifacts: before,
        scope:
          'mechanical fixture drill only; local transport omits provenance; no public registry writes or production provenance claim',
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Local fourteen-fixture partial/resume drill passed; evidence: ${report}`);
} finally {
  execFileSync('docker', ['rm', '-f', container], { timeout: 30_000, stdio: 'ignore' });
}
