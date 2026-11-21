import { defineConfig, mergeConfig } from 'vite-plus';

import testConfig from '../../test.config.ts';

export default mergeConfig(
  testConfig,
  defineConfig({
    pack: {
      entry: ['src/index.ts', 'src/pages.ts'],
      platform: 'neutral',
      target: 'es2023',
      format: ['esm'],
      dts: true,
      // The declaration packer drops source lib references; only Pages loads Next's PromiseWithResolvers types.
      banner: ({ fileName }): { readonly dts: string } => ({
        dts:
          '/// <reference path="./next-compat.d.ts" />\n/// <reference path="./sharp-compat.d.cts" />' +
          (fileName === 'pages.d.mts' ? '\n/// <reference lib="es2024.promise" />' : ''),
      }),
      outExtensions: () => ({ js: '.mjs', dts: '.d.mts' }),
      exports: { devExports: 'source' },
      unbundle: true,
      copy: { from: 'src/{next-compat.d.ts,sharp-compat.d.cts}', to: 'dist', flatten: true },
    },
    test: { include: ['src/**/*.test.ts'] },
  }),
);
