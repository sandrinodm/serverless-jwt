import { defineConfig, mergeConfig } from 'vite-plus';

import shared from '../test.config.ts';
export default mergeConfig(
  shared,
  defineConfig({
    test: {
      include: ['packages/jwt-verifier/src/**/*.test.ts'],
      exclude: ['**/workspace.test.ts'],
    },
  }),
);
