import { defineConfig, mergeConfig } from 'vite-plus';

import { policyPlugin } from '../../../packages/astro/src/bridge.ts';
import shared from '../../../test.config.ts';

export default mergeConfig(
  shared,
  defineConfig({
    plugins: [policyPlugin({ protect: 'predicate' })],
    test: { include: ['src/**/*.test.ts'] },
  }),
);
