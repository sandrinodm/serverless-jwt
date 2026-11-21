import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import YAML from 'yaml';

import { assertNetlifyLoggingPatch } from './netlify-logging.ts';
import { assertRouterLoggingPatch } from './router-logging.ts';

/**
 * Tests actual installed minimum or age-eligible maximum framework in a disposable workspace.
 */
const integration = process.argv[2] ?? 'reference-express';
/**
 * Requested endpoint of the declared framework peer range.
 */
const end = process.argv[3];
assert.ok(['min', 'max'].includes(end), 'Usage: pnpm test:peers reference-express min|max');
/**
 * Canonical source workspace, left unchanged by the copied install.
 */
const root = resolve(import.meta.dirname, '..');
/**
 * Example workspace whose framework peer and checks define this run.
 */
const appPath = `e2e/apps/${integration}`;
/**
 * Declared framework peer ranges from the selected example.
 */
const manifest = JSON.parse(readFileSync(join(root, appPath, 'package.json'), 'utf8'));
/**
 * Pinned registry client, invoked outside the development workspace.
 */
const npm = join(root, 'node_modules/npm/bin/npm-cli.js');
/**
 * Runs bounded child commands, optionally retaining registry and inventory output.
 */
const run = (command, args, cwd, capture = false) =>
  execFileSync(command, args, {
    cwd,
    timeout: 240_000,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
/**
 * Reads the actually resolved framework manifest even when exports intentionally hide package.json.
 */
function frameworkVersion(framework, appDirectory) {
  const require = createRequire(join(appDirectory, 'package.json'));
  let manifestFile;
  try {
    manifestFile = require.resolve(framework + '/package.json');
  } catch (cause) {
    if (cause?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
      throw cause;
    }

    const entry = run(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        'process.stdout.write(import.meta.resolve(process.argv[1]))',
        framework,
      ],
      appDirectory,
      true,
    );
    let directory = dirname(fileURLToPath(entry));
    for (;;) {
      const candidate = join(directory, 'package.json');
      if (existsSync(candidate)) {
        const manifest = JSON.parse(readFileSync(candidate, 'utf8'));
        if (manifest.name === framework) {
          manifestFile = candidate;
          break;
        }
      }

      const parent = dirname(directory);
      assert.notEqual(parent, directory, 'Resolved framework has no matching package manifest');
      directory = parent;
    }
  }

  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  assert.equal(manifest.name, framework);
  return manifest.version;
}
/**
 * Strict seven-day publication cutoff used for both range endpoints.
 */
const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
/**
 * Records selected and actually installed framework versions for the report.
 */
const resolutions = [];
for (const [framework, range] of Object.entries(manifest.peerDependencies)) {
  const command = [npm, 'view', framework, 'versions', 'time', '--json'];
  const raw = JSON.parse(run(process.execPath, command, tmpdir(), true));
  const metadata = Array.isArray(raw) ? Object.assign({}, ...raw) : raw;
  const eligible = metadata.versions
    .filter(
      (version) =>
        semver.valid(version) &&
        !semver.prerelease(version) &&
        semver.satisfies(version, range) &&
        Number.isFinite(Date.parse(metadata.time[version])) &&
        Date.parse(metadata.time[version]) <= cutoff,
    )
    .sort(semver.compare);
  assert.ok(eligible.length, 'No release satisfies the range and seven-day release age');
  const selected = end === 'min' ? eligible[0] : eligible.at(-1);
  resolutions.push({
    framework,
    range,
    selected,
    published: metadata.time[selected],
    cutoff: new Date(cutoff).toISOString(),
    command: [process.execPath, ...command],
  });
}

/**
 * Owns the disposable copied workspace and removes it after checks.
 */
using temporary = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-peers-'));
/**
 * Install destination isolated from the source checkout and its lockfile.
 */
const copy = temporary.path;
/**
 * Enumerates actual nonignored source inputs, including uncommitted rewrite files.
 */
const files = run(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  root,
  true,
)
  .split('\0')
  .filter(Boolean);
for (const file of files) {
  // Agent worktrees and repository metadata never become inputs to peer installs.
  if (
    !existsSync(join(root, file)) ||
    file.startsWith('.git/') ||
    file.startsWith('.claude/') ||
    file.startsWith('.agents/')
  ) {
    continue;
  }

  mkdirSync(dirname(join(copy, file)), { recursive: true });
  cpSync(join(root, file), join(copy, file), { dereference: false });
}

/**
 * Copy-only workspace manifest where peer overrides may be written.
 */
const workspaceFile = join(copy, 'pnpm-workspace.yaml');
/**
 * Preserves release-age policy while changing only copied peer overrides.
 */
const workspace = YAML.parse(readFileSync(workspaceFile, 'utf8'));
assert.equal(workspace.minimumReleaseAge, 10080);
assert.equal(workspace.minimumReleaseAgeStrict, true);
workspace.overrides ??= {};
for (const { framework, selected } of resolutions) {
  if (integration === 'nuxt-h3-v2' && framework === 'h3') {
    // Keep the independently compiled h3 v1 root on v1 while testing real v2 app and harness APIs.
    workspace.overrides['@serverless-jwt-internal/nuxt-h3-v2>h3'] = selected;
    workspace.overrides['h3-v2'] = 'npm:h3@' + selected;
  } else {
    workspace.overrides[framework] = selected;
  }
}

writeFileSync(workspaceFile, YAML.stringify(workspace));
run('pnpm', ['install', '--no-frozen-lockfile', '--ignore-scripts'], copy);
if (integration === 'react-router') {
  assertRouterLoggingPatch(join(copy, 'e2e/apps/react-router'));
}

if (integration === 'netlify') {
  assertNetlifyLoggingPatch(join(copy, 'e2e/apps/netlify'));
}

// Verify inherited remediations against the selected peer copy's actual installed consumers.
run(process.execPath, [join(copy, 'scripts/tooling-security.mjs'), copy], copy);
for (const resolution of resolutions) {
  const installed = frameworkVersion(resolution.framework, join(copy, appPath));
  assert.equal(
    installed,
    resolution.selected,
    'Peer override did not install the selected framework',
  );
  resolution.installed = installed;
}

// Framework build-policy configs import the real core while Vitest discovers every project.
// Build that shared dependency inside this copy before loading any selected conformance project.
run('pnpm', ['--filter', '@serverless-jwt/jwt-verifier', 'build'], copy);

if (manifest.scripts?.['prepare:peers']) {
  run('pnpm', ['--dir', appPath, 'prepare:peers'], copy);
}

run('pnpm', ['--dir', appPath, 'test:types'], copy);
run('pnpm', ['--dir', appPath, 'test:conformance'], copy);
mkdirSync(join(root, 'reports/peers'), { recursive: true });
writeFileSync(
  join(root, `reports/peers/${integration}-${end}.json`),
  JSON.stringify(
    {
      integration,
      end,
      resolutions,
      preparation: manifest.scripts?.['prepare:peers'] ? 'pass' : 'not-required',
      types: 'pass',
      conformance: 'pass',
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ integration, end, resolutions }));
