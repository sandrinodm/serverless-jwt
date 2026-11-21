import { readFileSync } from 'node:fs';
import { expect, it } from 'vite-plus/test';
import { parse } from 'yaml';

it('runs both peer endpoints for every P4 and P5 adapter in CI', () => {
  const workflow = parse(
    readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'),
  );
  const matrix = workflow.jobs.peers.strategy.matrix;
  expect(matrix.end).toEqual(['min', 'max']);
  expect(matrix.integration).toEqual([
    'reference-express',
    'cloudflare',
    'next',
    'hono',
    'vercel',
    'netlify',
    'sveltekit',
    'astro',
    'react-router',
    'tanstack-start',
    'express',
    'fastify',
    'aws-lambda',
    'next-pages',
    'netlify-v1',
    'nuxt',
    'nuxt-h3-v2',
  ]);
  expect(
    workflow.jobs.peers.steps.some(
      (step) => step.run === 'pnpm test:peers ${{ matrix.integration }} ${{ matrix.end }}',
    ),
  ).toBe(true);
});
