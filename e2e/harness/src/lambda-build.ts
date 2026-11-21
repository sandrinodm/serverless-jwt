import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'vite-plus';

/**
 * Bundles the public AWS adapter and portable core without source aliases or runtime dependencies.
 */
export async function buildLambda(directory: string, caFile: string): Promise<void> {
  mkdirSync(directory, { recursive: true });
  await build({
    configFile: false,
    logLevel: 'error',
    ssr: { noExternal: true },
    build: {
      ssr: true,
      target: 'node24',
      minify: false,
      outDir: directory,
      emptyOutDir: false,
      rolldownOptions: {
        input: resolve(import.meta.dirname, 'lambda-handler.ts'),
        output: { entryFileNames: 'index.mjs' },
      },
    },
  });
  copyFileSync(caFile, join(directory, 'ca.crt'));
}
