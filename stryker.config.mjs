/**
 * Security mutations use the real core suite and Vitest 5, retaining an 85% failure threshold. TS7
 * no longer exposes the compiler API Stryker uses solely to rewrite sandbox config paths. All
 * tsconfig paths stay within the copied sandbox, so that optional rewriting is unnecessary.
 */
export default {
  tsconfigFile: 'stryker-transpile-only.json',
  // Stryker copies directory symlinks as files; agent-only discovery links are not test inputs.
  ignorePatterns: ['.agents/**', '.claude/**'],
  mutate: [
    'packages/jwt-verifier/src/jwks/**/*.ts',
    'packages/jwt-verifier/src/fetch-state.ts',
    'packages/jwt-verifier/src/verify.ts',
    'packages/jwt-verifier/src/bearer.ts',
    'packages/jwt-verifier/src/adapter.ts',
    'packages/jwt-verifier/src/claims.ts',
    '!**/*.test.ts',
  ],
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: { configFile: 'scripts/mutation.config.mjs', related: false },
  reporters: ['clear-text', 'json', 'html'],
  coverageAnalysis: 'perTest',
  thresholds: { high: 85, low: 85, break: 85 },
  concurrency: 2,
  timeoutMS: 10000,
  tempDirName: '.stryker-tmp',
};
