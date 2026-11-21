import { expect, it } from 'vite-plus/test';

import { faultSuite } from '../../suites/faults.ts';

// Each case crosses real one-second cooldowns/backoffs, a slow-drip deadline and six child servers.
for (const [name, node] of [
  ['node26', process.execPath],
  ['node24-minimum', process.env.MIN_NODE_BIN],
] as const) {
  it(
    'real HTTPS fault matrix on ' + name,
    async () => {
      expect(node, 'MIN_NODE_BIN must name the exact minimum Node runtime').toBeTruthy();
      if (!node) {
        throw new Error('Minimum supported Node runtime is required');
      }

      await faultSuite(node);
    },
    30_000,
  );
}
