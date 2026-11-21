import { describe, expect, it } from 'vite-plus/test';

import { archiveContainerProof } from '../harness/src/archive.docker.ts';

describe.skipIf(!process.env.E2E_DOCKER)('actual fixed archive Docker API', () => {
  it('copies real archive bytes through Testcontainers into the pinned container', async () => {
    expect(await archiveContainerProof()).toBe('synthetic-archive-proof');
  }, 30_000);
});
