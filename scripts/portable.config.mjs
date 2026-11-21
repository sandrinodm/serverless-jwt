import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { readFileSync } from 'node:fs';
import { defineConfig, mergeConfig } from 'vite-plus';

import shared from '../test.config.ts';
export default mergeConfig(
  shared,
  defineConfig({
    plugins: [
      cloudflareTest({
        main: 'scripts/portable-worker.mjs',
        miniflare: {
          compatibilityDate: '2026-11-03',
          compatibilityFlags: ['nodejs_compat'],
          bindings: { PORTABLE_INPUT: process.env.PORTABLE_INPUT },
          serviceBindings: {
            ISSUER: {
              external: {
                address: new URL(JSON.parse(process.env.PORTABLE_INPUT).issuer).host,
                https: {
                  certificateHost: '127.0.0.1',
                  tlsOptions: {
                    trustBrowserCas: true,
                    trustedCertificates: [
                      readFileSync(
                        new URL('../packages/testkit/fixtures/ca.crt', import.meta.url),
                        'utf8',
                      ),
                    ],
                  },
                },
              },
            },
          },
        },
      }),
    ],
    test: { include: ['scripts/portable-workerd.test.mjs'] },
  }),
);
