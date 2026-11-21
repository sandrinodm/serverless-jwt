import type { StartedNetwork } from 'testcontainers';

import { readFileSync } from 'node:fs';

import { dockerPort } from './docker-port.ts';

/**
 * All daemon-created helper images are immutable before Testcontainers is imported.
 */
const pinned = JSON.parse(readFileSync(new URL('../../images.json', import.meta.url), 'utf8')) as {
  readonly images: Readonly<Record<string, { readonly image: string }>>;
};
process.env.RYUK_CONTAINER_IMAGE = image('ryuk');
process.env.SSHD_CONTAINER_IMAGE = image('sshd');
process.env.TESTCONTAINERS_RYUK_PORT ??= String(await dockerPort());
process.env.TESTCONTAINERS_SSHD_PORT ??= String(await dockerPort());

/**
 * Resolves a checked-in digest without allowing a floating tag or caller-provided override.
 */
export function image(name: string): string {
  const value = pinned.images[name]?.image;
  if (!value || !/@sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error('Docker image must be pinned by digest');
  }

  return value;
}

/**
 * Creates a uniquely owned network after helper image pins have been established.
 */
export async function privateNetwork(): Promise<StartedNetwork> {
  const { Network } = await import('testcontainers');
  return new Network().start();
}
