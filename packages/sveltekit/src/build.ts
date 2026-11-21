import type { Adapter, AdapterViteConfig, Builder } from '@sveltejs/kit';

import { ConfigurationError } from '@serverless-jwt/jwt-verifier';

import { policyPlugin } from './bridge.ts';
import { matchesPath, routingPath, validatePatterns } from './protection.ts';

/**
 * Uses the real framework's public Vite plugin type without widening its interface.
 */
type Plugin = Extract<NonNullable<AdapterViteConfig['plugins']>, ReadonlyArray<unknown>>[number];

/**
 * One registered policy binds runtime decisions to the adapter's production artifact checks.
 */
export interface JwtAdapterOptions {
  /**
   * Patterns describe deployment paths including any base; predicates explicitly waive static
   * analysis.
   */
  readonly protect: ReadonlyArray<string> | 'predicate';
}

/**
 * Preserves public adapter hooks and plugin ordering while adding the obligatory policy bridge.
 */
function registeredVite(config: AdapterViteConfig | undefined, plugin: Plugin): AdapterViteConfig {
  const original = config ?? {};
  const plugins = original.plugins;
  return {
    ...original,
    ...(original.getRequest ? { getRequest: original.getRequest.bind(original) } : {}),
    ...(original.setResponse ? { setResponse: original.setResponse.bind(original) } : {}),
    plugins: Array.isArray(plugins)
      ? [plugin, ...plugins]
      : { ...plugins, pre: [plugin, ...(plugins?.pre ?? [])] },
  };
}

/**
 * Converts concrete public artifact paths into deployment paths consistently with runtime URLs.
 */
function deploymentPath(path: string, base: string): string {
  const decoded = routingPath(path);
  return base && decoded !== base && !decoded.startsWith(base + '/') ? base + decoded : decoded;
}

/**
 * Rejects protected concrete artifacts and true/auto routes even when prerender errors were
 * ignored.
 */
function assertNoProtectedPrerender(builder: Builder, patterns: ReadonlyArray<string>): void {
  const base = routingPath(builder.config.paths.base);
  const prerendered = builder.prerendered;
  const paths = [
    ...prerendered.paths,
    ...prerendered.pages.keys(),
    ...prerendered.assets.keys(),
    ...prerendered.redirects.keys(),
  ];
  if (paths.some((path) => matchesPath(deploymentPath(path, base), patterns))) {
    throw new ConfigurationError('Protected SvelteKit routes must not be prerendered');
  }

  for (const route of builder.routes) {
    if (route.prerender === false) {
      continue;
    }

    const exact = patterns.filter((pattern) => !pattern.endsWith('/**'));
    if (
      exact.some(
        (pattern) =>
          (!base || pattern === base || pattern.startsWith(base + '/')) &&
          route.pattern.test(base ? pattern.slice(base.length) || '/' : pattern),
      )
    ) {
      throw new ConfigurationError('Protected SvelteKit routes must not be prerendered');
    }

    if (!patterns.some((pattern) => pattern.endsWith('/**'))) {
      continue;
    }

    if (
      route.segments.some(
        (segment) => segment.dynamic || segment.rest || /[%[\]]/u.test(segment.content),
      )
    ) {
      throw new ConfigurationError(
        'Cannot prove prerendered SvelteKit route is outside protected subtrees',
      );
    }

    const path =
      '/' +
      route.segments
        .filter((segment) => !(segment.content.startsWith('(') && segment.content.endsWith(')')))
        .map((segment) => segment.content)
        .join('/');
    if (!route.pattern.test(path) || matchesPath(base + path, patterns)) {
      throw new ConfigurationError(
        'Protected or unsupported SvelteKit route must not be prerendered',
      );
    }
  }
}

/**
 * Wraps a real adapter; protected static output is rejected before its adapt method can run.
 */
export function serverlessJwtAdapter(adapter: Adapter, options: JwtAdapterOptions): Adapter {
  const patterns =
    options?.protect === 'predicate' ? undefined : validatePatterns(options?.protect);
  const plugin = policyPlugin(patterns ? { protect: patterns } : { protect: 'predicate' });
  const vite = adapter.vite;
  return {
    ...adapter,
    name: 'serverless-jwt(' + adapter.name + ')',
    ...(adapter.emulate ? { emulate: adapter.emulate.bind(adapter) } : {}),
    vite:
      typeof vite === 'function'
        ? (context): AdapterViteConfig => registeredVite(vite.call(adapter, context), plugin)
        : registeredVite(vite, plugin),
    adapt: (builder: Builder): ReturnType<Adapter['adapt']> => {
      if (patterns) {
        assertNoProtectedPrerender(builder, patterns);
      }

      return adapter.adapt.call(adapter, builder);
    },
  };
}
