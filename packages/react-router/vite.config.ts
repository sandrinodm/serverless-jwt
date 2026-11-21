import { defineConfig, mergeConfig } from 'vite-plus';

import testConfig from '../../test.config.ts';

export default mergeConfig(
  testConfig,
  defineConfig({
    pack: {
      entry: ['src/index.ts'],
      platform: 'neutral',
      target: 'es2023',
      format: ['esm'],
      dts: true,
      outExtensions: () => ({ js: '.mjs', dts: '.d.mts' }),
      exports: { devExports: 'source' },
      unbundle: true,
    },
    test: { include: ['src/**/*.test.ts'] },
  }),
);
