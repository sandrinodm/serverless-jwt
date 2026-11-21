import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from 'vite-plus/test';

test('lists exactly the intended workspace packages', () => {
  const root = resolve(import.meta.dirname, '../../..');
  const output = execFileSync('pnpm', ['-r', 'ls', '--depth', '-1', '--json'], {
    cwd: root,
    encoding: 'utf8',
  });
  const packages = JSON.parse(output) as ReadonlyArray<{ readonly name: string }>;
  expect(packages.map((entry) => entry.name).sort()).toEqual([
    '@serverless-jwt-internal/astro',
    '@serverless-jwt-internal/aws-lambda',
    '@serverless-jwt-internal/cloudflare',
    '@serverless-jwt-internal/e2e-harness',
    '@serverless-jwt-internal/express',
    '@serverless-jwt-internal/fastify',
    '@serverless-jwt-internal/hono',
    '@serverless-jwt-internal/netlify',
    '@serverless-jwt-internal/netlify-v1',
    '@serverless-jwt-internal/next',
    '@serverless-jwt-internal/next-pages',
    '@serverless-jwt-internal/nitro',
    '@serverless-jwt-internal/nuxt',
    '@serverless-jwt-internal/nuxt-h3-v2',
    '@serverless-jwt-internal/react-router',
    '@serverless-jwt-internal/reference-express',
    '@serverless-jwt-internal/solidstart',
    '@serverless-jwt-internal/sveltekit',
    '@serverless-jwt-internal/tanstack-start',
    '@serverless-jwt-internal/vercel',
    '@serverless-jwt/astro',
    '@serverless-jwt/aws-lambda',
    '@serverless-jwt/cloudflare',
    '@serverless-jwt/express',
    '@serverless-jwt/fastify',
    '@serverless-jwt/hono',
    '@serverless-jwt/jwt-verifier',
    '@serverless-jwt/netlify',
    '@serverless-jwt/next',
    '@serverless-jwt/nuxt',
    '@serverless-jwt/react-router',
    '@serverless-jwt/sveltekit',
    '@serverless-jwt/tanstack-start',
    '@serverless-jwt/testkit',
    '@serverless-jwt/vercel',
    'serverless-jwt-monorepo',
  ]);
});
