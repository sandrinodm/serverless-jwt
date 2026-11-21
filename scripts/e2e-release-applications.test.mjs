import { readdirSync } from 'node:fs';
import { expect, it } from 'vite-plus/test';

import { capabilityMatrix } from '../e2e/matrix.ts';
import { buildApplicationNames, releaseApplicationNames } from './e2e-release-applications.mjs';

it('keeps all17 PR apps in exact release while required native Nuxt hosts remain nightly assignments', () => {
  const applications = readdirSync(new URL('../e2e/apps', import.meta.url));
  const names = releaseApplicationNames(capabilityMatrix, applications);
  expect(names).toHaveLength(17);
  expect(new Set(names).size).toBe(17);
  expect(names).not.toContain('nitro');
  expect(names).not.toContain('solidstart');
  expect(
    capabilityMatrix
      .filter((row) => ['nitro', 'solidstart'].includes(row.application))
      .map((row) => row.project),
  ).toEqual(['nightly', 'nightly']);
  for (const row of capabilityMatrix.filter((row) => row.project === 'pr')) {
    expect(names).toContain(row.application ?? row.integration);
  }

  expect(() => releaseApplicationNames(capabilityMatrix, applications, 'solidstart')).toThrow(
    'No PR application',
  );
  expect(() =>
    releaseApplicationNames(capabilityMatrix, [...applications, 'unregistered']),
  ).toThrow('no capability matrix registration');
  expect(() =>
    releaseApplicationNames(
      capabilityMatrix,
      applications.filter((name) => name !== 'hono'),
    ),
  ).toThrow('PR matrix application is missing');
});

it('builds native Nuxt hosts only when nightly is explicitly assigned', () => {
  const applications = readdirSync(new URL('../e2e/apps', import.meta.url));
  expect(
    buildApplicationNames(capabilityMatrix, applications, 'pr', 'nuxt').sort((a, b) =>
      a.localeCompare(b),
    ),
  ).toEqual(['nuxt', 'nuxt-h3-v2']);
  expect(
    buildApplicationNames(capabilityMatrix, applications, 'nightly', 'nuxt').sort((a, b) =>
      a.localeCompare(b),
    ),
  ).toEqual(['nitro', 'nuxt', 'nuxt-h3-v2', 'solidstart']);
  expect(buildApplicationNames(capabilityMatrix, applications, 'pr')).toHaveLength(17);
  expect(buildApplicationNames(capabilityMatrix, applications, 'nightly')).toHaveLength(19);
  expect(() => buildApplicationNames(capabilityMatrix, applications, 'unknown')).toThrow(
    'Unknown e2e build project',
  );
});
