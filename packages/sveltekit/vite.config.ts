import { defineConfig, mergeConfig } from 'vite-plus';

import testConfig from '../../test.config.ts';
import { policyPlugin } from './src/bridge.ts';

export default mergeConfig(
  testConfig,
  defineConfig({
    plugins: [policyPlugin({ protect: ['/api/**'] })],
    pack: {
      entry: ['src/index.ts', 'src/build.ts', 'src/policy.ts'],
      platform: 'neutral',
      target: 'es2023',
      format: ['esm'],
      dts: true,
      deps: { neverBundle: ['#serverless-jwt-policy'] },
      outExtensions: () => ({ js: '.mjs', dts: '.d.mts' }),
      exports: false,
      unbundle: true,
    },
    test: { include: ['src/**/*.test.ts'] },
  }),
);
