import type { AstroIntegration, IntegrationResolvedRoute } from 'astro';

import { ConfigurationError } from '@serverless-jwt/jwt-verifier';
import { expect, it } from 'vite-plus/test';

import { policyPlugin } from './bridge.ts';
import { serverlessJwt } from './build.ts';
import { registeredPolicy } from './policy.ts';

/**
 * SDK-shaped unit metadata is independently checked against actual production build captures.
 */
function routeFixture(
  values: Partial<Omit<IntegrationResolvedRoute, 'pathname'>> & {
    readonly pathname?: string | undefined;
  } = {},
): IntegrationResolvedRoute {
  const { pathname, ...rest } = values;
  const path = Object.hasOwn(values, 'pathname') ? pathname : '/public';
  return {
    params: [],
    ...(path === undefined ? {} : { pathname: path }),
    segments: [[{ content: 'public', dynamic: false, spread: false }]],
    type: 'page',
    origin: 'project',
    pattern: '/public',
    patternRegex: /^\/public\/?$/,
    entrypoint: 'src/pages/public.astro',
    isPrerendered: true,
    fallbackRoutes: [],
    generate: (): string => '/public',
    ...rest,
  };
}

/**
 * Invokes only public hook fields consumed by the integration; full SDK callbacks run in build
 * tests.
 */
function evaluate(
  integration: AstroIntegration,
  routes: IntegrationResolvedRoute[],
  paths: string[] = [],
  assets = new Map<string, URL[]>(),
  base = '/',
  dir = new URL('file:///output/'),
): void {
  void integration.hooks['astro:config:done']?.({ config: { base } } as never);
  void integration.hooks['astro:routes:resolved']?.({ routes } as never);
  void integration.hooks['astro:build:done']?.({
    pages: paths.map((pathname) => ({ pathname })),
    assets,
    dir,
  } as never);
}

it('keeps an immutable unregistered sentinel and requires nonempty supported policies', () => {
  expect(registeredPolicy).toEqual({ kind: 'unregistered' });
  expect(Object.isFrozen(registeredPolicy)).toBe(true);
  expect(() => serverlessJwt({ protect: [] })).toThrow(ConfigurationError);
});

it('registers through the supported config updater and represents predicate analysis explicitly', () => {
  const configured: unknown[] = [];
  const integration = serverlessJwt({ protect: ['/api/**'] });
  void integration.hooks['astro:config:setup']?.({
    updateConfig: (value: unknown) => {
      configured.push(value);
    },
  } as never);
  expect(configured).toHaveLength(1);
  expect(configured[0]).toMatchObject({
    vite: { plugins: [{ name: 'serverless-jwt-astro-policy' }] },
  });
  expect(() =>
    evaluate(
      serverlessJwt({ protect: 'predicate' }),
      [routeFixture({ pathname: '/api/me' })],
      ['/api/me'],
    ),
  ).not.toThrow();
});

it('checks real emitted URL values instead of non-prerendered route association keys', () => {
  const integration = serverlessJwt({ protect: ['/api/**'] });
  expect(() =>
    evaluate(
      integration,
      [routeFixture({ pathname: '/api/me', isPrerendered: false })],
      [],
      new Map([['/api/me', []]]),
    ),
  ).not.toThrow();
  expect(() =>
    evaluate(
      integration,
      [],
      [],
      new Map([['/public', [new URL('file:///output/api/private.json')]]]),
    ),
  ).toThrow(ConfigurationError);
  expect(() =>
    evaluate(
      integration,
      [],
      [],
      new Map([['/public', [new URL('file:///output/api/private.json')]]]),
      '/',
      new URL('file:///output'),
    ),
  ).toThrow(ConfigurationError);
  expect(() =>
    evaluate(
      integration,
      [],
      [],
      new Map([
        [
          '/public',
          [
            new URL('https://cdn.example/api/private.json'),
            new URL('file://remote/output/api/private.json'),
            new URL('file:///outside/api/private.json'),
          ],
        ],
      ]),
    ),
  ).not.toThrow();
  expect(() => evaluate(integration, [], ['/api/me'])).toThrow(ConfigurationError);
});

it('normalizes deployment bases and checks exact native route matchers', () => {
  const api = routeFixture({
    pathname: undefined,
    patternRegex: /^\/api\/me$/,
    segments: [
      [{ content: 'api', dynamic: false, spread: false }],
      [{ content: 'me', dynamic: false, spread: false }],
    ],
  });
  expect(() =>
    evaluate(serverlessJwt({ protect: ['/base/api/me'] }), [api], [], new Map(), '/b%61se/'),
  ).toThrow(ConfigurationError);
  expect(() =>
    evaluate(
      serverlessJwt({ protect: ['/base/api/**'] }),
      [api],
      ['/base/api/me'],
      new Map(),
      '/base/',
    ),
  ).toThrow(ConfigurationError);
  expect(() =>
    evaluate(serverlessJwt({ protect: ['/base/api/**'] }), [api], [], new Map(), '/base/'),
  ).toThrow(ConfigurationError);
  expect(() =>
    evaluate(
      serverlessJwt({ protect: ['/base'] }),
      [routeFixture({ pathname: undefined, patternRegex: /^\/$/ })],
      [],
      new Map(),
      '/base',
    ),
  ).toThrow(ConfigurationError);
  expect(() => evaluate(serverlessJwt({ protect: ['/api/me'] }), [api])).toThrow(
    ConfigurationError,
  );
  expect(() =>
    evaluate(serverlessJwt({ protect: ['/other/api/me'] }), [api], [], new Map(), '/base'),
  ).not.toThrow();
  expect(() => evaluate(serverlessJwt({ protect: ['/else'] }), [api])).not.toThrow();
  expect(() => evaluate(serverlessJwt({ protect: ['/api/**'] }), [api])).toThrow(
    ConfigurationError,
  );
});

it('covers concrete paths, conservative unknown overlap and redirect/fallback relationships', () => {
  const integration = serverlessJwt({ protect: ['/api/**'] });
  expect(() => evaluate(integration, [routeFixture({ pathname: '/api/me' })])).toThrow(
    ConfigurationError,
  );
  for (const part of [
    { content: 'id', dynamic: true, spread: false },
    { content: 'rest', dynamic: false, spread: true },
    { content: '%name', dynamic: false, spread: false },
  ]) {
    expect(() =>
      evaluate(integration, [routeFixture({ pathname: undefined, segments: [[part]] })]),
    ).toThrow(ConfigurationError);
  }

  expect(() =>
    evaluate(integration, [routeFixture({ pathname: undefined, patternRegex: /^\/else$/ })]),
  ).toThrow(ConfigurationError);
  expect(() => evaluate(integration, [routeFixture()])).not.toThrow();
  const root = routeFixture();
  root.fallbackRoutes.push(root);
  expect(() => evaluate(integration, [root])).not.toThrow();
  const denied = routeFixture({ pathname: '/api/private' });
  expect(() => evaluate(integration, [routeFixture({ fallbackRoutes: [denied] })])).toThrow(
    ConfigurationError,
  );
  expect(() => evaluate(integration, [routeFixture({ redirectRoute: denied })])).toThrow(
    ConfigurationError,
  );
});

it('snapshots mutable native route records and the caller policy', () => {
  const protect = ['/api/**'];
  const integration = serverlessJwt({ protect });
  protect[0] = '/public/**';
  const route = routeFixture({ pathname: '/api/private' });
  void integration.hooks['astro:routes:resolved']?.({ routes: [route] } as never);
  route.pathname = '/public';
  route.isPrerendered = false;
  route.segments[0]?.push({ content: 'changed', dynamic: false, spread: false });
  expect(
    () =>
      void integration.hooks['astro:build:done']?.({
        pages: [],
        assets: new Map(),
        dir: new URL('file:///output/'),
      } as never),
  ).toThrow(ConfigurationError);
});

it('keeps the policy seam private, immutable and limited to this Astro package', async () => {
  for (const protect of [['/api/**'], 'predicate'] as const) {
    const plugin = policyPlugin({ protect });
    const resolve = plugin.resolveId;
    const load = plugin.load;
    const config = plugin.config;
    if (
      typeof resolve !== 'function' ||
      typeof load !== 'function' ||
      typeof config !== 'function'
    ) {
      throw new Error('Unexpected plugin hook shape');
    }

    const id = resolve.call(undefined as never, '#serverless-jwt-astro-policy', undefined, {
      isEntry: false,
    });
    expect(
      resolve.call(undefined as never, '#serverless-jwt-policy', undefined, { isEntry: false }),
    ).toBeNull();
    expect(load.call(undefined as never, 'unrelated')).toBeNull();
    const code = load.call(undefined as never, id as string);
    const module = await import(
      'data:text/javascript;base64,' + Buffer.from(code as string).toString('base64')
    );
    expect(Object.isFrozen(module.registeredPolicy)).toBe(true);
    expect(
      Array.isArray(protect)
        ? Object.isFrozen(module.registeredPolicy.patterns)
        : module.registeredPolicy.kind === 'predicate',
    ).toBe(true);
    expect(config.call(undefined as never, {}, { command: 'build', mode: 'test' })).toEqual({
      ssr: { noExternal: ['@serverless-jwt/astro'] },
    });
  }
});
