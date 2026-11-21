import { resolve } from 'node:path';
import { build } from 'vite-plus';

/**
 * Bundles the real Hono app and built public-library exports for native non-Node runtimes.
 */
await build({
  configFile: false,
  build: {
    target: 'es2023',
    sourcemap: true,
    outDir: resolve(import.meta.dirname, 'dist'),
    lib: {
      entry: resolve(import.meta.dirname, 'src/app.ts'),
      formats: ['es'],
      fileName: () => 'app.mjs',
    },
  },
});
