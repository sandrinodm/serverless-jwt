import { describe, it } from 'vite-plus/test';

import { measureFlociCapacity } from '../harness/src/floci-capacity.docker.ts';

describe.skipIf(!process.env.E2E_DOCKER)('measured actual Floci execution capacity', () => {
  // This explicit diagnostic is also performed inside each full200 case, never read from stale disk.
  it('measures a bounded native sample with eight concurrent subjects', async () => {
    await measureFlociCapacity();
  }, 180_000);
});
