import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vite-plus/test';

import { capabilityMatrix } from '../../matrix.ts';

it('covers every public integration export independently from runtime registration', () => {
  const packages = resolve(import.meta.dirname, '../../../packages');
  const missing: string[] = [];
  for (const directory of readdirSync(packages)) {
    const manifest = JSON.parse(
      readFileSync(resolve(packages, directory, 'package.json'), 'utf8'),
    ) as {
      readonly private?: boolean;
      readonly name: string;
      readonly exports?: Readonly<Record<string, unknown>>;
    };
    if (manifest.private || directory === 'jwt-verifier') {
      continue;
    }

    for (const entrypoint of Object.keys(manifest.exports ?? {}).filter(
      (key) => key !== './package.json',
    )) {
      if (
        !capabilityMatrix.some(
          (row) => row.integration === directory && row.entrypoint === entrypoint,
        )
      ) {
        missing.push(manifest.name + ':' + entrypoint);
      }
    }
  }

  expect(
    missing,
    'Every new public export needs an explicit host, route and capability row',
  ).toEqual([]);
  expect(new Set(capabilityMatrix.map((row) => row.id)).size).toBe(capabilityMatrix.length);
  const preparation = capabilityMatrix.filter((row) => row.streaming === 'preparation-only');
  expect(preparation).toHaveLength(1);
  expect(preparation[0]).toMatchObject({
    id: 'astro-type-repair',
    integration: 'astro',
    entrypoint: './type-repair',
    duplicates: null,
    duplicateReason: expect.stringMatching(/^not enforceable here:.*no HTTP/),
  });
  expect(capabilityMatrix.filter((row) => row.duplicates === null)).toEqual(preparation);
  for (const row of capabilityMatrix.filter((entry) => entry.streaming !== 'preparation-only')) {
    expect(row.duplicates).not.toBeNull();
    expect(row.duplicates).toHaveLength(2);
    expect(
      row.duplicates?.every((status) => Number.isInteger(status) && status >= 100 && status <= 599),
    ).toBe(true);
  }

  for (const row of capabilityMatrix.filter(
    (entry) => entry.duplicates !== null && entry.duplicates.some((status) => status !== 400),
  )) {
    expect(row.duplicateReason).toMatch(/^not enforceable here:/);
  }
});
