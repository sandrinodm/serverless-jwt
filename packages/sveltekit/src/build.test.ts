import type { Adapter, AdapterViteConfig, Builder, RouteDefinition } from '@sveltejs/kit';

import { ConfigurationError } from '@serverless-jwt/jwt-verifier';
import { expect, it } from 'vite-plus/test';

import { policyPlugin } from './bridge.ts';
import { serverlessJwtAdapter } from './build.ts';
import { registeredPolicy } from './policy.ts';

/**
 * Unit builders expose only inspected public metadata; real production tests independently capture
 * native builders.
 */
function builderFixture(
  paths: ReadonlyArray<string> = [],
  routes: ReadonlyArray<Partial<RouteDefinition>> = [],
  base = '',
): Builder {
  return {
    config: { paths: { base } },
    prerendered: { paths: [...paths], pages: new Map(), assets: new Map(), redirects: new Map() },
    routes: routes.map((route) => ({
      id: '/public',
      prerender: true,
      pattern: /^\/public\/?$/,
      segments: [{ content: 'public', dynamic: false, rest: false }],
      ...route,
    })),
  } as Builder;
}

it('keeps ordinary imports safe but exposes only an immutable unregistered sentinel', () => {
  expect(registeredPolicy).toEqual({ kind: 'unregistered' });
  expect(Object.isFrozen(registeredPolicy)).toBe(true);
});

it('preserves adapter composition, receiver bindings and both public plugin arrangements', async () => {
  for (const objectForm of [false, true]) {
    const existing = { name: 'existing-plugin' };
    const post = { name: 'post-plugin' };
    const vite: AdapterViteConfig = {
      plugins: objectForm ? { pre: [existing], post: [post] } : [existing],
      getRequest: function (): Request {
        expect(this).toBe(vite);
        return new Request('https://example.test');
      },
      setResponse: function (): void {
        expect(this).toBe(vite);
      },
    };
    let adapted = 0;
    const inner: Adapter = {
      name: 'inner',
      supports: { read: () => true, instrumentation: () => true },
      emulate: function () {
        expect(this).toBe(inner);
        return {};
      },
      vite: function (context) {
        expect(this).toBe(inner);
        expect(context.config).toBeDefined();
        return vite;
      },
      adapt: function (): void {
        expect(this).toBe(inner);
        adapted++;
      },
    };
    const wrapped = serverlessJwtAdapter(inner, { protect: ['/api/**'] });
    expect(wrapped.supports).toBe(inner.supports);
    expect(wrapped.name).toBe('serverless-jwt(inner)');
    await wrapped.emulate?.();
    expect(typeof wrapped.vite).toBe('function');
    const configured =
      typeof wrapped.vite === 'function'
        ? wrapped.vite({ config: builderFixture().config })
        : wrapped.vite;
    expect(configured?.getRequest?.(undefined as never).url).toBe('https://example.test/');
    configured?.setResponse?.(undefined as never, new Response());
    const plugins = configured?.plugins;
    const pre = Array.isArray(plugins) ? plugins : plugins?.pre;
    const after = Array.isArray(plugins) ? [] : (plugins?.post ?? []);
    expect(pre?.map((plugin) => plugin.name)).toEqual([
      'serverless-jwt-sveltekit-policy',
      'existing-plugin',
    ]);
    expect(after).toEqual(objectForm ? [post] : []);
    await wrapped.adapt(builderFixture(['/public'], [{ prerender: false }]));
    expect(adapted).toBe(1);
  }
});

it('rejects protected path, page, asset and redirect metadata before inner adaptation', () => {
  let calls = 0;
  const wrapped = serverlessJwtAdapter(
    {
      name: 'inner',
      adapt: () => {
        calls++;
      },
    },
    { protect: ['/api/**'] },
  );
  const inputs = [
    builderFixture(['/api/me']),
    builderFixture(['/api/']),
    builderFixture(['/%61pi/me']),
    builderFixture(['/api/me'], [], '/base'),
  ];
  for (const key of ['pages', 'assets', 'redirects'] as const) {
    const builder = builderFixture();
    builder.prerendered[key].set('/api/private', {} as never);
    inputs.push(builder);
  }

  for (const builder of inputs.slice(0, 3).concat(inputs.slice(4))) {
    expect(() => wrapped.adapt(builder)).toThrow(ConfigurationError);
  }

  const based = serverlessJwtAdapter(
    {
      name: 'inner',
      adapt: () => {
        calls++;
      },
    },
    { protect: ['/base/api/**'] },
  );
  expect(() => based.adapt(inputs[3] as Builder)).toThrow(ConfigurationError);
  expect(() => based.adapt(builderFixture(['/api/me'], [], '/base'))).toThrow(ConfigurationError);
  expect(calls).toBe(0);
});

it('checks exact route patterns and conservatively rejects unknown dynamic subtree overlap', () => {
  const inner: Adapter = { name: 'inner', adapt: () => {} };
  const exact = serverlessJwtAdapter(inner, { protect: ['/base/api/me'] });
  expect(() =>
    exact.adapt(builderFixture([], [{ pattern: /^\/api\/me$/, prerender: 'auto' }], '/base')),
  ).toThrow(ConfigurationError);
  expect(() =>
    exact.adapt(builderFixture([], [{ pattern: /^\/public$/, prerender: true }], '/base')),
  ).not.toThrow();
  expect(() =>
    exact.adapt(builderFixture([], [{ pattern: /^\/api\/me$/, prerender: true }], '/other')),
  ).not.toThrow();
  const rootExact = serverlessJwtAdapter(inner, { protect: ['/api/me'] });
  expect(() =>
    rootExact.adapt(builderFixture([], [{ pattern: /^\/api\/me$/, prerender: true }])),
  ).toThrow(ConfigurationError);
  const basedRoot = serverlessJwtAdapter(inner, { protect: ['/base'] });
  expect(() =>
    basedRoot.adapt(builderFixture([], [{ pattern: /^\/$/, prerender: true }], '/base')),
  ).toThrow(ConfigurationError);
  const wildcard = serverlessJwtAdapter(inner, { protect: ['/api/**'] });
  for (const segment of [
    { content: '[id]', dynamic: true, rest: false },
    { content: '[...rest]', dynamic: false, rest: true },
    { content: '[x+61]', dynamic: false, rest: false },
  ]) {
    expect(() => wildcard.adapt(builderFixture([], [{ segments: [segment] }]))).toThrow(
      ConfigurationError,
    );
  }

  expect(() =>
    wildcard.adapt(
      builderFixture(
        [],
        [{ pattern: /^\/else$/, segments: [{ content: 'public', dynamic: false, rest: false }] }],
      ),
    ),
  ).toThrow(ConfigurationError);
  expect(() =>
    wildcard.adapt(
      builderFixture(
        [],
        [
          {
            pattern: /^\/api\/me$/,
            segments: [
              { content: '(group)', dynamic: false, rest: false },
              { content: 'api', dynamic: false, rest: false },
              { content: 'me', dynamic: false, rest: false },
            ],
          },
        ],
      ),
    ),
  ).toThrow(ConfigurationError);
  expect(() =>
    wildcard.adapt(
      builderFixture(
        [],
        [
          {
            pattern: /^\/public$/,
            segments: [
              { content: '(group)', dynamic: false, rest: false },
              { content: 'public', dynamic: false, rest: false },
            ],
          },
        ],
      ),
    ),
  ).not.toThrow();
});

it('forwards predicate registrations and original adaptation failures without static-analysis claims', async () => {
  const failure = new Error('Original adapter failure');
  const wrapped = serverlessJwtAdapter(
    {
      name: 'inner',
      vite: {},
      adapt: async () => {
        throw failure;
      },
    },
    { protect: 'predicate' },
  );
  await expect(wrapped.adapt(builderFixture(['/api/private']))).rejects.toBe(failure);
  expect(wrapped.vite).toBeDefined();
});

it('injects only immutable registered policy and leaves unrelated module requests alone', async () => {
  for (const protect of [['/api/**'], 'predicate'] as const) {
    const plugin = policyPlugin({ protect });
    const resolveId = plugin.resolveId;
    const load = plugin.load;
    const config = plugin.config;
    expect(typeof resolveId).toBe('function');
    expect(typeof load).toBe('function');
    if (
      typeof resolveId !== 'function' ||
      typeof load !== 'function' ||
      typeof config !== 'function'
    ) {
      throw new Error('Unexpected plugin hook shape');
    }

    const id = resolveId.call(undefined as never, '#serverless-jwt-policy', undefined, {
      isEntry: false,
    });
    expect(
      resolveId.call(undefined as never, 'unrelated', undefined, { isEntry: false }),
    ).toBeNull();
    expect(load.call(undefined as never, 'unrelated')).toBeNull();
    const code = load.call(undefined as never, id as string);
    expect(typeof code).toBe('string');
    const value = await import(
      'data:text/javascript;base64,' + Buffer.from(code as string).toString('base64')
    );
    expect(Object.isFrozen(value.registeredPolicy)).toBe(true);
    expect(
      Array.isArray(protect)
        ? Object.isFrozen(value.registeredPolicy.patterns)
        : value.registeredPolicy.kind === 'predicate',
    ).toBe(true);

    expect(config.call(undefined as never, {}, { command: 'build', mode: 'test' })).toEqual({
      ssr: { noExternal: ['@serverless-jwt/sveltekit'] },
    });
  }
});
