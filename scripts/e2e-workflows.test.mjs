import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it, vi } from 'vite-plus/test';
import { parse } from 'yaml';

import { capabilityMatrix, flociIsolationFile } from '../e2e/matrix.ts';
import E2eReporter from './e2e-reporter.mjs';
import { assertNightlyCapacity } from './nightly-capacity.mjs';

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal()),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

it('runs the standard nightly independently and requires a hosted larger runner for Floci200', () => {
  const workflow = parse(
    readFileSync(new URL('../.github/workflows/nightly.yml', import.meta.url), 'utf8'),
  );
  const { nightly, floci200, 'floci200-native': native, report } = workflow.jobs;
  expect(workflow.on.pull_request.paths).toEqual(['e2e/images.json']);
  expect(nightly['runs-on']).toBe('ubuntu-latest');
  expect(workflow.permissions).toEqual({ contents: 'read' });
  expect(nightly.steps[0].with['persist-credentials']).toBe(false);
  expect(nightly.steps.some((step) => step.run === 'node scripts/nightly-capacity.mjs')).toBe(
    false,
  );
  expect(nightly.steps.find((step) => step.run === 'pnpm test:e2e:nightly').env).toEqual({
    E2E_NIGHTLY_SCOPE: 'standard',
  });
  expect(native.if).toBe(
    "vars.FLOCI_NIGHTLY_RUNNER_GROUP != '' && vars.FLOCI_NIGHTLY_RUNNER != ''",
  );
  expect(native['runs-on']).toEqual({
    group: '${{ vars.FLOCI_NIGHTLY_RUNNER_GROUP }}',
    labels: '${{ vars.FLOCI_NIGHTLY_RUNNER }}',
  });
  expect(native.steps[0].env.RUNNER_ENVIRONMENT).toBe('${{ runner.environment }}');
  expect(native.steps[0].run).toContain('requires a GitHub-hosted larger runner');
  expect(native.steps[0].run).toContain('exit 1');
  expect(native.steps[1].with['persist-credentials']).toBe(false);
  expect(native.steps[2].run).toBe('node scripts/nightly-capacity.mjs');
  expect(native.steps.find((step) => step.run === 'pnpm test:e2e:nightly').env).toEqual({
    E2E_NIGHTLY_SCOPE: 'floci200',
  });
  expect(native.steps.at(-1).with['if-no-files-found']).toBe('error');
  expect(floci200.needs).toBe('floci200-native');
  expect(floci200.if).toBe('always()');
  expect(floci200['runs-on']).toBe('ubuntu-latest');
  expect(floci200.steps[0].run).toContain('Floci200 has not run');
  expect(floci200.steps[0].run).toContain('"$FLOCI_RESULT" != success');
  expect(report.needs).toEqual(['nightly', 'floci200']);
  expect(report.if).toContain("needs.floci200.result != 'success'");
});

it('packs the core before fresh jobs invoke root test project discovery', () => {
  const ci = parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  const nightly = parse(
    readFileSync(new URL('../.github/workflows/nightly.yml', import.meta.url), 'utf8'),
  );
  for (const { steps } of [ci.jobs['core-node'], ci.jobs['core-nightly'], nightly.jobs.nightly]) {
    const install = steps.findIndex((step) => step.run === 'pnpm install --frozen-lockfile');
    const pack = steps.findIndex(
      (step) => step.run === 'pnpm --dir packages/jwt-verifier exec vp pack',
    );
    const test = steps.findIndex(
      (step) => step.run?.includes('vp test run') || step.run === 'pnpm test:properties:nightly',
    );
    expect(install).toBeGreaterThanOrEqual(0);
    expect(pack).toBeGreaterThan(install);
    expect(test).toBeGreaterThan(pack);
  }
});

it.each(['standard', 'floci200'])('loads the scoped nightly project for %s', async (scope) => {
  vi.stubEnv('E2E_NIGHTLY_SCOPE', scope);
  vi.resetModules();
  const { default: config } = await import('../e2e/vite.config.ts');
  const { test } = config.test.projects.find((project) => project.test.name === 'nightly');
  if (scope === 'floci200') {
    expect(test.include).toEqual([flociIsolationFile]);
  } else {
    expect(test.include).toContain('e2e/platforms/*.docker.e2e.ts');
    expect(test.exclude).toContain(flociIsolationFile);
  }
});

/**
 * Exercises matrix reporting using completed test identities and records executed row membership.
 */
function reportRows(scope, completed) {
  vi.stubEnv('E2E_NIGHTLY_SCOPE', scope);
  const reporter = new E2eReporter();
  reporter.onTestRunStart([{ project: { name: 'nightly' } }]);
  for (const row of completed) {
    reporter.onTestCaseResult({
      result: () => ({ state: 'passed' }),
      module: { moduleId: `/checkout/${row.file}` },
      name: `capability: ${row.id}`,
    });
  }

  reporter.onTestRunEnd();
  return JSON.parse(vi.mocked(writeFileSync).mock.lastCall[1]);
}

it('reports disjoint nightly scopes and rejects an omitted Floci200 row', () => {
  const floci = capabilityMatrix.filter((row) => row.file === flociIsolationFile);
  const standard = capabilityMatrix.filter((row) => row.file !== flociIsolationFile);
  const full = reportRows(undefined, capabilityMatrix);
  const standardReport = reportRows('standard', standard);
  const flociReport = reportRows('floci200', floci);
  expect(standardReport.scope).toBe('standard');
  expect(standardReport.excludedRows).toEqual(['aws-lambda-floci-v1', 'aws-lambda-floci-v2']);
  expect(flociReport.scope).toBe('floci200');
  expect(flociReport.excludedRows).toEqual(standard.map((row) => row.id));
  const combined = [...standardReport.rows, ...flociReport.rows];
  expect(combined).toHaveLength(full.rows.length);
  expect(new Set(combined.map((row) => row.id))).toEqual(new Set(full.rows.map((row) => row.id)));
  expect(() => reportRows('floci200', floci.slice(0, 1))).toThrow(
    'Every assigned e2e capability row must pass',
  );
});

it('rejects standard and memory-constrained hosts while preserving the larger-runner requirement', () => {
  const host = {
    platform: 'linux',
    arch: 'x64',
    cpus: 16,
    totalKiB: 64 * 1024 * 1024,
    availableKiB: 50 * 1024 * 1024,
  };
  expect(() => assertNightlyCapacity(host)).not.toThrow();
  expect(() => assertNightlyCapacity({ ...host, cpus: 4, totalKiB: 16 * 1024 * 1024 })).toThrow(
    '16-core',
  );
  expect(() => assertNightlyCapacity({ ...host, limitKiB: 16 * 1024 * 1024 })).toThrow('64GB');
  expect(() => assertNightlyCapacity({ ...host, availableKiB: 30 * 1024 * 1024 })).toThrow(
    'more than30GiB',
  );
});
