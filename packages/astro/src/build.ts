import type { AstroIntegration, IntegrationResolvedRoute, RoutePart } from 'astro';

import { ConfigurationError } from '@serverless-jwt/jwt-verifier';

import { policyPlugin } from './bridge.ts';
import { matchesPath, routingPath, validatePatterns } from './protection.ts';

/**
 * Build registration explicitly distinguishes patterns from unanalysable predicates.
 */
export interface AstroJwtOptions {
  /**
   * Deployment paths include the configured base; predicates require explicit registration.
   */
  readonly protect: ReadonlyArray<string> | 'predicate';
}

/**
 * Owned public route metadata remains stable across subsequent framework integration hooks.
 */
interface ProtectedRoute {
  /**
   * Concrete native pathname is available for static routes.
   */
  readonly pathname: string | undefined;

  /**
   * The framework's real route matcher handles exact protected paths.
   */
  readonly pattern: RegExp;

  /**
   * True means output can bypass runtime middleware.
   */
  readonly prerendered: boolean;

  /**
   * Public route parts permit conservative subtree-overlap checks.
   */
  readonly segments: ReadonlyArray<ReadonlyArray<Readonly<RoutePart>>>;
}

/**
 * Captures every reported route, redirect and fallback without retaining mutable framework arrays.
 */
function snapshotRoutes(
  input: ReadonlyArray<IntegrationResolvedRoute>,
): ReadonlyArray<ProtectedRoute> {
  const seen = new Set<IntegrationResolvedRoute>();
  const output: ProtectedRoute[] = [];
  /**
   * Follows only public route relationships and terminates on cycles.
   */
  const visit = (route: IntegrationResolvedRoute): void => {
    if (seen.has(route)) {
      return;
    }

    seen.add(route);
    output.push(
      Object.freeze({
        pathname: route.pathname,
        pattern: new RegExp(route.patternRegex.source, route.patternRegex.flags),
        prerendered: route.isPrerendered,
        segments: Object.freeze(
          route.segments.map((segment) =>
            Object.freeze(segment.map((part) => Object.freeze({ ...part }))),
          ),
        ),
      }),
    );
    for (const fallback of route.fallbackRoutes) {
      visit(fallback);
    }

    if (route.redirectRoute) {
      visit(route.redirectRoute);
    }
  };
  for (const route of input) {
    visit(route);
  }

  return Object.freeze(output);
}

/**
 * Concrete framework paths and route metadata share the runtime deployment-path contract.
 */
function deploymentPath(path: string, base: string): string {
  const decoded = routingPath(path.startsWith('/') ? path : '/' + path);
  return base && decoded !== base && !decoded.startsWith(base + '/') ? base + decoded : decoded;
}

/**
 * Fails completed builds before protected static output can be accepted for deployment.
 */
function assertProtectedRoutes(
  routes: ReadonlyArray<ProtectedRoute>,
  paths: ReadonlyArray<string>,
  patterns: ReadonlyArray<string>,
  base: string,
): void {
  if (paths.some((path) => matchesPath(deploymentPath(path, base), patterns))) {
    throw new ConfigurationError('Protected Astro routes must not be prerendered');
  }

  for (const route of routes) {
    if (route.prerendered === false) {
      continue;
    }

    if (
      route.pathname !== undefined &&
      matchesPath(deploymentPath(route.pathname, base), patterns)
    ) {
      throw new ConfigurationError('Protected Astro routes must not be prerendered');
    }

    if (
      patterns.some(
        (pattern) =>
          !pattern.endsWith('/**') &&
          (!base || pattern === base || pattern.startsWith(base + '/')) &&
          route.pattern.test(base ? pattern.slice(base.length) || '/' : pattern),
      )
    ) {
      throw new ConfigurationError('Protected Astro routes must not be prerendered');
    }

    if (!patterns.some((pattern) => pattern.endsWith('/**'))) {
      continue;
    }

    if (
      route.segments.some((segment) =>
        segment.some((part) => part.dynamic || part.spread || /[%[\]]/u.test(part.content)),
      )
    ) {
      throw new ConfigurationError(
        'Cannot prove prerendered Astro route is outside protected subtrees',
      );
    }

    const path =
      '/' + route.segments.map((segment) => segment.map((part) => part.content).join('')).join('/');
    if (!route.pattern.test(path) || matchesPath(base + path, patterns)) {
      throw new ConfigurationError('Protected or unsupported Astro route must not be prerendered');
    }
  }
}

/**
 * Binds the real runtime policy to supported Astro/Vite hooks and checks native prerender metadata.
 */
export function serverlessJwt(options: AstroJwtOptions): AstroIntegration {
  const patterns =
    options?.protect === 'predicate' ? undefined : validatePatterns(options?.protect);
  const plugin = policyPlugin(patterns ? { protect: patterns } : { protect: 'predicate' });
  let base = '';
  let routes: ReadonlyArray<ProtectedRoute> = [];
  return {
    name: 'serverless-jwt',
    hooks: {
      'astro:config:setup': ({ updateConfig }): void => {
        updateConfig({ vite: { plugins: [plugin] } });
      },
      'astro:config:done': ({ config }): void => {
        const normalized = routingPath(config.base);
        base = normalized === '/' ? '' : normalized.replace(/\/$/u, '');
      },
      'astro:routes:resolved': ({ routes: resolved }): void => {
        routes = snapshotRoutes(resolved);
      },
      'astro:build:done': ({ pages, assets, dir }): void => {
        if (patterns) {
          const paths = pages.map((page) => page.pathname);
          const directory = dir.pathname.endsWith('/') ? dir.pathname : dir.pathname + '/';
          for (const files of assets.values()) {
            for (const file of files) {
              if (
                file.protocol === dir.protocol &&
                file.host === dir.host &&
                file.pathname.startsWith(directory)
              ) {
                paths.push('/' + file.pathname.slice(directory.length));
              }
            }
          }

          assertProtectedRoutes(routes, paths, patterns, base);
        }
      },
    },
  };
}
