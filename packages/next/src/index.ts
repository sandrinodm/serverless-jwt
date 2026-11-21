/// <reference path="./next-compat.d.ts" preserve="true" />
/// <reference path="./sharp-compat.d.cts" preserve="true" />

import type { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type {
  Decision,
  Guard,
  IntegrationOptions,
  RequestInfoLike,
} from '@serverless-jwt/jwt-verifier/adapter';
import type { NextRequest } from 'next/server.js';

import {
  authorizationFromHeaders,
  createGuard,
  toResponse,
} from '@serverless-jwt/jwt-verifier/adapter';

/**
 * Authentication mode controls missing-credential inference.
 */
type Mode = 'required' | 'optional';
/**
 * Only an explicit synchronous skip grants unauthenticated access.
 */
type Skip = ((request: RequestInfoLike) => boolean) | undefined;

/**
 * Next's App Router resolves dynamic route parameters asynchronously.
 */
export interface RouteContext {
  /**
   * Original framework-owned promise, forwarded without awaiting or replacing it.
   */
  readonly params: Promise<Readonly<Record<string, string | ReadonlyArray<string> | undefined>>>;
}

/**
 * Handler authentication includes only the policy's enabled missing-credential states.
 */
export type NextAuth<TIdentity, TMode extends Mode = 'required', TSkip extends Skip = undefined> =
  | Auth<TIdentity>
  | (TMode extends 'optional' ? null : never)
  | (TSkip extends undefined ? never : undefined);

/**
 * Route options own a typed awaited error hook and one module-scope verifier.
 */
export type NextOptions<
  TIdentity = VerifiedClaims,
  TContext = RouteContext,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = IntegrationOptions<TIdentity> & {
  /**
   * Required by default; invalid tokens reject in both modes.
   */
  readonly mode?: TMode;
  /**
   * Explicitly permits unauthenticated requests, receiving the cheap request view.
   */
  readonly skip?: TSkip;
  /**
   * Custom responses should retain no-store; undefined selects the safe default.
   */
  readonly onError?: (
    error: JwtVerifierError,
    request: NextRequest,
    context: TContext,
  ) => Response | undefined | Promise<Response | undefined>;
};

/**
 * Route handlers retain the real NextRequest and every original route-context field.
 */
export type JwtRouteHandler<
  TIdentity,
  TContext = RouteContext,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = (
  request: NextRequest,
  context: TContext,
  auth: NextAuth<TIdentity, TMode, TSkip>,
) => Response | Promise<Response>;

/**
 * Proxy hooks reject early without making authenticated state available to downstream routes.
 */
export type ProxyOptions<TIdentity = VerifiedClaims> = IntegrationOptions<TIdentity> & {
  /**
   * Undefined selects the default; failures emit the fixed integration diagnostic.
   */
  readonly onError?: (
    error: JwtVerifierError,
    request: NextRequest,
  ) => Response | undefined | Promise<Response | undefined>;
};

/**
 * Preserves the original Next request and cancellation signal without consuming its body.
 */
function decide<TIdentity, TMode extends Mode>(
  guard: Guard<TIdentity, TMode>,
  request: NextRequest,
): Promise<Decision<TIdentity, TMode>> {
  return guard.decide(
    {
      method: request.method,
      url: request.url,
      authorization: authorizationFromHeaders(request.headers),
      header: (name: string): string | undefined => request.headers.get(name) ?? undefined,
    },
    request.signal,
  );
}

/**
 * Awaits only the rejection hook, isolating failures before returning the default response.
 */
async function reject<TIdentity, TMode extends Mode>(
  guard: Guard<TIdentity, TMode>,
  decision: Extract<Decision<TIdentity, TMode>, { readonly kind: 'reject' }>,
  hook?: () => Response | undefined | Promise<Response | undefined>,
): Promise<Response> {
  if (hook) {
    try {
      const response = await hook();
      if (response !== undefined) {
        if (!(response instanceof Response) || response.bodyUsed || response.body?.locked) {
          throw new Error('Unusable custom response');
        }

        return response;
      }
    } catch {
      guard.reportErrorHookFailure();
    }
  }

  return toResponse(decision.http);
}

/**
 * Protects an App Router handler with an explicit skip-aware authentication argument.
 */
export function withJwt<
  TIdentity = VerifiedClaims,
  TContext = RouteContext,
  TMode extends Mode = 'required',
>(
  options: NextOptions<TIdentity, TContext, TMode, (request: RequestInfoLike) => boolean> & {
    readonly skip: (request: RequestInfoLike) => boolean;
  },
  handler: JwtRouteHandler<TIdentity, TContext, TMode, (request: RequestInfoLike) => boolean>,
): (request: NextRequest, context: TContext) => Promise<Response>;

/**
 * Required-by-default handlers receive nonnullable Auth unless optional mode is selected.
 */
export function withJwt<
  TIdentity = VerifiedClaims,
  TContext = RouteContext,
  TMode extends Mode = 'required',
>(
  options: NextOptions<TIdentity, TContext, TMode>,
  handler: JwtRouteHandler<TIdentity, TContext, TMode>,
): (request: NextRequest, context: TContext) => Promise<Response>;

/**
 * Broad pretyped policies retain all enabled states instead of promising a narrower handler.
 */
export function withJwt<
  TIdentity = VerifiedClaims,
  TContext = RouteContext,
  TMode extends Mode = Mode,
>(
  options: NextOptions<TIdentity, TContext, TMode, Skip>,
  handler: JwtRouteHandler<TIdentity, TContext, TMode, Skip>,
): (request: NextRequest, context: TContext) => Promise<Response>;

/**
 * Constructs one verifier at module scope and calls application code outside authentication
 * catches.
 */
export function withJwt<
  TIdentity = VerifiedClaims,
  TContext = RouteContext,
  TMode extends Mode = Mode,
>(
  options: NextOptions<TIdentity, TContext, TMode, Skip>,
  handler:
    | JwtRouteHandler<TIdentity, TContext, TMode>
    | JwtRouteHandler<TIdentity, TContext, TMode, Skip>,
): (request: NextRequest, context: TContext) => Promise<Response> {
  const guard = createGuard<TIdentity, TMode>(options);
  const { onError } = options;
  return async (request: NextRequest, context: TContext): Promise<Response> => {
    const decision = await decide(guard, request);
    if (decision.kind === 'reject') {
      return reject(
        guard,
        decision,
        onError ? () => onError(decision.error, request, context) : undefined,
      );
    }

    return (handler as JwtRouteHandler<TIdentity, TContext, TMode, Skip>)(
      request,
      context,
      (decision.kind === 'skip' ? undefined : decision.auth) as NextAuth<TIdentity, TMode, Skip>,
    );
  };
}

/**
 * Rejects early from proxy.ts, returning undefined to continue; always verify again in the route.
 */
export function createProxyGuard<TIdentity = VerifiedClaims>(
  options: ProxyOptions<TIdentity>,
): (request: NextRequest) => Promise<Response | undefined> {
  const guard = createGuard<TIdentity, Mode>(options);
  const { onError } = options;
  return async (request: NextRequest): Promise<Response | undefined> => {
    const decision = await decide(guard, request);
    if (decision.kind === 'reject') {
      return reject(guard, decision, onError ? () => onError(decision.error, request) : undefined);
    }

    return undefined;
  };
}
