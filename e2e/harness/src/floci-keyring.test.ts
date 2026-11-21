import { expect, it } from 'vite-plus/test';

import { assertKernelKeyQuota } from './floci-keyring.ts';

it('rejects the actual rootless quota that produced 46 native cold200 failures', () => {
  expect(() =>
    assertKernelKeyQuota({ maxKeys: 200, maxBytes: 20_000, usedKeys: 41, usedBytes: 2311 }),
  ).toThrow('Floci200 requires available Docker-user kernel key quota');
});

it('rejects corrupt capacity observations and exhausted byte quota without provisioning', () => {
  expect(() =>
    assertKernelKeyQuota({ maxKeys: Number.NaN, maxBytes: 200_000, usedKeys: 41, usedBytes: 2311 }),
  ).toThrow('Cannot inspect local Docker keyring capacity');
  expect(() =>
    assertKernelKeyQuota({ maxKeys: 2000, maxBytes: 2500, usedKeys: 41, usedBytes: 2311 }),
  ).toThrow('Floci200 requires available Docker-user kernel key quota');
});

it('permits provisioned quota to proceed to the unchanged actual native capacity proof', () => {
  expect(() =>
    assertKernelKeyQuota({ maxKeys: 2000, maxBytes: 200_000, usedKeys: 41, usedBytes: 2311 }),
  ).not.toThrow();
});
