import { defineConfig, mergeConfig } from 'vite-plus';

import shared from '../test.config.ts';
export default mergeConfig(
  shared,
  defineConfig({ test: { benchmark: { include: ['scripts/benchmark.bench.mjs'] } } }),
);
