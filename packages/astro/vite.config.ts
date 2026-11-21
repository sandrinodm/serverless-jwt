import { defineConfig, mergeConfig } from 'vite-plus';

import testConfig from '../../test.config.ts';
import { policyPlugin } from './src/bridge.ts';

export default mergeConfig(
  testConfig,
  defineConfig({
    plugins: [policyPlugin({ protect: ['/api/**'] })],
    pack: {
      entry: ['src/index.ts', 'src/build.ts', 'src/policy.ts', 'src/type-repair.ts'],
      platform: 'neutral',
      target: 'es2023',
      format: ['esm'],
      dts: true,
      deps: {
        neverBundle: [
          '#serverless-jwt-astro-policy',
          'node:crypto',
          'node:fs',
          'node:module',
          'node:path',
          'node:url',
        ],
      },
      outExtensions: () => ({ js: '.mjs', dts: '.d.mts' }),
      exports: false,
      unbundle: true,
      copy: { from: 'type-repair/**/*', to: 'dist/type-repair', flatten: false },
    },
    test: { include: ['src/**/*.test.ts'] },
  }),
);
