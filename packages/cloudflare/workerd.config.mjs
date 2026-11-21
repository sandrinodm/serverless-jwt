import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { mkdirSync, writeFileSync } from 'node:fs';
import { defineConfig, mergeConfig } from 'vite-plus';

import shared from '../../test.config.ts';

export default mergeConfig(
  shared,
  defineConfig({
    plugins: [
      cloudflareTest({
        main: 'packages/cloudflare/src/worker.spec.mjs',
        miniflare: {
          compatibilityDate: '2026-11-03',
          compatibilityFlags: ['nodejs_compat'],
          serviceBindings: {
            REPORT: async (request) => {
              if (new URL(request.url).pathname === '/jwks') {
                const { keys } = await request.json();
                await new Promise((resolve) => setTimeout(resolve, 100));
                return Response.json({ keys });
              }

              const { name, results } = await request.json();
              if (!['cloudflare/workers', 'cloudflare/pages'].includes(name)) {
                throw new Error('Unknown Cloudflare conformance form');
              }

              mkdirSync('reports/conformance-workerd', { recursive: true });
              writeFileSync(
                'reports/conformance-workerd/' + name.replaceAll('/', '-') + '.json',
                JSON.stringify(results, null, 2) + '\n',
              );
              return new Response(null, { status: 204 });
            },
          },
        },
      }),
    ],
    test: {
      reporters: [
        'default',
        ['./scripts/conformance-reporter.mjs', { directory: 'reports/conformance-workerd' }],
      ],
      include: ['packages/cloudflare/src/conformance.workerd.test.mjs'],
    },
  }),
);
