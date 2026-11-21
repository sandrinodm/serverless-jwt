import { expect, it } from 'vite-plus/test';

import { verifyToolingSecurity } from './tooling-security.mjs';

it('verifies reviewed code, secure returned prototypes and real framework configuration consumers', async () => {
  const consumers = await verifyToolingSecurity();
  expect(consumers).toHaveLength(3);
});
