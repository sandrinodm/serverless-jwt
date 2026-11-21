# @serverless-jwt/next

Generated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.

## index.d.mts

```ts
import { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
/// <reference path="./next-compat.d.ts" />
/// <reference path="./sharp-compat.d.cts" />
import { IntegrationOptions, RequestInfoLike } from '@serverless-jwt/jwt-verifier/adapter';
import { NextRequest } from 'next/server.js';
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
 * Protects an App Router handler with an explicit skip-aware authentication argument.
 */
export declare function withJwt<
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
export declare function withJwt<
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
export declare function withJwt<
  TIdentity = VerifiedClaims,
  TContext = RouteContext,
  TMode extends Mode = Mode,
>(
  options: NextOptions<TIdentity, TContext, TMode, Skip>,
  handler: JwtRouteHandler<TIdentity, TContext, TMode, Skip>,
): (request: NextRequest, context: TContext) => Promise<Response>;
/**
 * Rejects early from proxy.ts, returning undefined to continue; always verify again in the route.
 */
export declare function createProxyGuard<TIdentity = VerifiedClaims>(
  options: ProxyOptions<TIdentity>,
): (request: NextRequest) => Promise<Response | undefined>;
export {};
```

## next-compat.d.ts

```ts
/**
 * Resolves Next16.4.5's directory reference to its exact shipped Satori declaration.
 */
declare module 'next/dist/compiled/@vercel/og/satori' {
  export * from 'next/dist/compiled/@vercel/og/satori/index.js';
}
```

## sharp-compat.d.cts

```ts
import type sharp = require('sharp');
import type { SharpConstructor as ESMSharpConstructor } from 'sharp' with {
  'resolution-mode': 'import',
};

/**
 * Links Sharp0.35.5's missing CJS alias to the exact ESM interface from the same package.
 */
declare module 'sharp' {
  type SharpConstructor = ESMSharpConstructor;
}
```
