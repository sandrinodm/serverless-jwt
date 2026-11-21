import { defineConfig } from 'vite-plus';

/**
 * Paths neither the formatter nor the linter touches: dependencies, build output and agent
 * worktrees.
 */
const ignoredPatterns = [
  '**/.claude/**',
  '**/.stryker-tmp/**',
  '**/reports/**',
  '**/coverage/**',
  '**/.reference/**',
  '**/dist/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.nitro/**',
  '**/next-env.d.ts',
  '**/node_modules/**',
  '**/routeTree.gen.ts',
  '**/*.tsbuildinfo',
  'pnpm-lock.yaml',
  // Consumer fixtures are checked in isolated packed-package consumers.
  '**/fixtures/**',
  // Immutable audited SDK declarations, licenses and archived generator inputs retain exact bytes.
  'packages/astro/type-repair/**',
  'e2e/apps/sveltekit/build/**',
  'e2e/apps/react-router/build/**',
  '**/{.wrangler,.netlify,.vercel,.svelte-kit,.astro,.output,.react-router,.tanstack}/**',
];

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
    // jsdoc-lint checks a file named on the command line even when `jsdoc.json` excludes it, so
    // this glob leaves out tests and declarations itself.
    'packages/*/src/**/!(*.test|*.spec|*.d).{ts,mts,cts}': 'jsdoc-lint',
    'scripts/**/!(*.test|*.spec|*.d).{ts,mts}': 'jsdoc-lint',
  },
  fmt: {
    arrowParens: 'always',
    bracketSameLine: true,
    bracketSpacing: true,
    jsdoc: {
      commentLineStrategy: 'multiline',
    },
    objectWrap: 'preserve',
    printWidth: 100,
    semi: true,
    singleQuote: true,
    sortImports: {
      groups: [
        'type-import',
        ['value-builtin', 'value-external'],
        'type-internal',
        'value-internal',
        ['type-parent', 'type-sibling', 'type-index'],
        ['value-parent', 'value-sibling', 'value-index'],
        'unknown',
      ],
    },
    sortPackageJson: true,
    ignorePatterns: ignoredPatterns,
  },
  lint: {
    plugins: ['typescript', 'unicorn', 'oxc', 'jsdoc'],
    jsPlugins: [
      { name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' },
      { name: '@stylistic', specifier: '@stylistic/eslint-plugin' },
    ],
    rules: {
      curly: 'error',
      // Explicit types protect isolated declaration generation.
      'typescript/no-explicit-any': 'error',
      // Missing values must be narrowed before use.
      'typescript/no-non-null-assertion': 'error',
      // Type imports remain erased at runtime.
      'typescript/consistent-type-imports': 'error',
      // Public boundaries document their return types.
      'typescript/explicit-module-boundary-types': 'error',
      // Builtins use their unambiguous protocol.
      'unicorn/prefer-node-protocol': 'error',
      // Error-code handling must cover every variant.
      'typescript/switch-exhaustiveness-check': 'error',
      // A blank line after a block when more code follows it in the same block. The `block-like`
      // selector is left out on purpose: it also matches `const handler = () => { … };`.
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: ['if', 'for', 'while', 'do', 'switch', 'try'], next: '*' },
      ],
      'jsdoc/check-tag-names': 'error',
      'jsdoc/check-access': 'error',
      'jsdoc/check-property-names': 'error',
      'jsdoc/require-property': 'off',
      'jsdoc/require-property-description': 'off',
      'jsdoc/require-property-name': 'off',
      'jsdoc/require-property-type': 'off',
      'jsdoc/require-yields': 'off',

      'typescript/no-deprecated': 'error',
      'vite-plus/prefer-vite-plus-imports': 'error',
    },
    // Root type checks include tooling; typecheck:lib separately enforces production globals.
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ignoredPatterns,
    overrides: [
      {
        files: ['packages/*/src/**'],
        rules: {
          'no-console': 'error',
          'no-restricted-imports': [
            'error',
            {
              patterns: [
                '@serverless-jwt/cloudflare',
                '@serverless-jwt/cloudflare/**',
                '@serverless-jwt/astro',
                '@serverless-jwt/astro/**',
                '@serverless-jwt/sveltekit',
                '@serverless-jwt/sveltekit/**',
                '@serverless-jwt/netlify',
                '@serverless-jwt/netlify/**',
                '@serverless-jwt/vercel',
                '@serverless-jwt/vercel/**',
                '@serverless-jwt/next',
                '@serverless-jwt/next/**',
                '@serverless-jwt/hono',
                '@serverless-jwt/hono/**',
                '@serverless-jwt/astro',
                '@serverless-jwt/astro/**',
                '@serverless-jwt/sveltekit',
                '@serverless-jwt/sveltekit/**',
                '@serverless-jwt/netlify',
                '@serverless-jwt/netlify/**',
                '@serverless-jwt/astro',
                '@serverless-jwt/astro/**',
                '@serverless-jwt/sveltekit',
                '@serverless-jwt/sveltekit/**',
                '@serverless-jwt/astro',
                '@serverless-jwt/astro/**',
                '@serverless-jwt/react-router',
                '@serverless-jwt/react-router/**',
                '@serverless-jwt/tanstack-start',
                '@serverless-jwt/tanstack-start/**',
                '@serverless-jwt/nuxt',
                '@serverless-jwt/nuxt/**',
                '@serverless-jwt/express',
                '@serverless-jwt/express/**',
                '@serverless-jwt/fastify',
                '@serverless-jwt/fastify/**',
                '@serverless-jwt/aws-lambda',
                '@serverless-jwt/aws-lambda/**',
              ],
            },
          ],
        },
      },
      {
        files: ['packages/jwt-verifier/src/**/*.ts'],
        rules: {
          'no-restricted-imports': [
            'error',
            {
              patterns: [
                {
                  group: ['*', '!./**', '!../**', '!jose'],
                  message: 'Core production imports only jose and relative modules.',
                },
              ],
            },
          ],
        },
      },
      { files: ['packages/*/src/**/*.ts'], rules: { 'oxc/no-barrel-file': 'error' } },
      { files: ['packages/*/src/index.ts'], rules: { 'oxc/no-barrel-file': 'off' } },
      {
        // Exact ambient/CJS declaration companions must load without creating runtime imports.
        files: ['packages/next/src/index.ts', 'packages/next/src/pages.ts'],
        rules: { 'typescript/triple-slash-reference': ['error', { path: 'always' }] },
      },
      {
        files: ['**/*.{test,spec}.ts'],
        plugins: ['vitest'],
        rules: {
          // Vitest's expect(value, message) form is used for readable failures.
          'no-restricted-imports': 'off',
          'vitest/valid-expect': ['error', { maxArgs: 2 }],
          'vitest/require-mock-type-parameters': 'off',
        },
      },
    ],
  },
  test: {
    reporters: ['default', './scripts/conformance-reporter.mjs'],
    projects: ['packages/*/vite.config.ts', 'e2e/apps/*/vite.config.ts', 'scripts/vite.config.ts'],
    coverage: {
      provider: 'v8',
      include: ['**/src/**/*.ts'],
      exclude: ['**/testkit/**', '**/*.test.ts', '**/*.spec.ts', '**/index.ts'],
      reporter: ['text', 'json', 'json-summary'],
      thresholds: { lines: 100, branches: 100 },
    },
  },
  run: {
    cache: { scripts: false, tasks: true },
  },
});
