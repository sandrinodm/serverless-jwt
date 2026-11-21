import { afterEach, expect, it, vi } from 'vite-plus/test';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each(['reference-express', 'hono', 'react-router'])(
  'prepares native controls only in their owning %s shard',
  async (integration) => {
    vi.stubEnv('E2E_INTEGRATION', integration);
    vi.resetModules();
    const { default: configuration } = await import('../../vite.config.ts');
    const pr = configuration.test?.projects?.[0] as {
      readonly test: { readonly include: ReadonlyArray<string> };
    };
    const includes = pr.test.include;
    expect(includes.includes('e2e/harness/src/router-logs.test.ts')).toBe(
      integration === 'react-router',
    );
    for (const name of [
      'logs',
      'log-stream',
      'release',
      'release-shadow',
      'router-patch',
      'netlify-patch',
      'cache',
    ]) {
      expect(includes).toContain('e2e/harness/src/' + name + '.test.ts');
    }
  },
);
