import { defineConfig, mergeConfig } from 'vite-plus';

import testConfig from '../../test.config.ts';
export default mergeConfig(testConfig, defineConfig({ test: { include: ['src/**/*.test.ts'] } }));
