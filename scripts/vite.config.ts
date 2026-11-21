import { defineProject, mergeConfig } from 'vite-plus';

import testConfig from '../test.config.ts';

export default mergeConfig(
  testConfig,
  defineProject({
    test: {
      name: 'foundation tooling',
      include: ['**/*.test.mjs'],
      exclude: ['**/portable-workerd.test.mjs'],
    },
  }),
);
