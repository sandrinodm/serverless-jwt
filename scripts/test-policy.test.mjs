import { resolve } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { createVitest } from 'vite-plus/test/node';

test.each([undefined, 'e2e/vite.config.ts'])(
  'applies shared policy and workspace source resolution to every project in %s',
  async (config) => {
    const context = await createVitest({
      root: resolve(import.meta.dirname, '..'),
      watch: false,
      ...(config ? { config } : {}),
    });
    try {
      expect(context.projects.length).toBeGreaterThanOrEqual(2);
      if (config) {
        expect(context.projects.map((project) => project.name).sort()).toEqual(['nightly', 'pr']);
      }

      for (const project of context.projects) {
        expect(project.config).toMatchObject({
          restoreMocks: true,
          unstubGlobals: true,
          unstubEnvs: true,
          testTimeout: 5_000,
          hookTimeout: 5_000,
          sequence: { shuffle: Boolean(process.env.CI) },
        });
        expect(project.vite.config.resolve.conditions).toContain('source');
        expect(project.vite.config.ssr.resolve.conditions).toContain('source');
      }
    } finally {
      await context.close();
    }
  },
);
