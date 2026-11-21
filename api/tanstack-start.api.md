# @serverless-jwt/tanstack-start

Generated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.

## index.d.mts

```ts
import { VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import { FunctionMiddlewareServerFn, RequestServerFn } from '@tanstack/start-client-core';

import { Mode, Skip, TanStackAuth, TanStackOptions } from './policy.mjs';
/**
 * Server-only context is passed through next; it is never copied into client sendContext.
 */
export interface JwtContext<
  TIdentity,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> {
  /**
   * Verified identity, optional missing null, or deliberate skip undefined belongs to this request.
   */
  readonly auth: TanStackAuth<TIdentity, TMode, TSkip>;
}
/**
 * Native request callback retains the factory's mapped identity and enabled auth states.
 */
export type RequestJwtMiddleware<
  TIdentity,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = RequestServerFn<{}, undefined, JwtContext<TIdentity, TMode, TSkip>>;
/**
 * Native function callback sends auth only through server context, never client sendContext.
 */
export type FunctionJwtMiddleware<
  TIdentity,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = FunctionMiddlewareServerFn<
  {},
  unknown,
  undefined,
  undefined,
  JwtContext<TIdentity, TMode, TSkip>,
  undefined
>;
/**
 * Creates the native request-server callback for a first-party createMiddleware().server call.
 * Keeping the factory inside server(...) lets Start remove its complete policy from browser code.
 */
export declare function jwtMiddleware<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: TanStackOptions<TIdentity, TMode, Exclude<Skip, undefined>> & {
    readonly skip: Exclude<Skip, undefined>;
  },
): RequestJwtMiddleware<TIdentity, TMode, Exclude<Skip, undefined>>;
/**
 * Required-by-default callbacks preserve nonnullable mapped auth.
 */
export declare function jwtMiddleware<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: TanStackOptions<TIdentity, TMode>,
): RequestJwtMiddleware<TIdentity, TMode>;
/**
 * Pretyped broad request policies preserve all their declared auth states.
 */
export declare function jwtMiddleware<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: TanStackOptions<TIdentity, TMode, Skip>,
): RequestJwtMiddleware<TIdentity, TMode, Skip>;
/**
 * Creates a native function-server callback using Start's actual current-request accessor. Function
 * middleware rejects by throwing Response, as required by its real next-result contract.
 */
export declare function jwtFunctionMiddleware<
  TIdentity = VerifiedClaims,
  TMode extends Mode = 'required',
>(
  options: TanStackOptions<TIdentity, TMode, Exclude<Skip, undefined>> & {
    readonly skip: Exclude<Skip, undefined>;
  },
): FunctionJwtMiddleware<TIdentity, TMode, Exclude<Skip, undefined>>;
/**
 * Required-by-default function callbacks preserve nonnullable mapped auth.
 */
export declare function jwtFunctionMiddleware<
  TIdentity = VerifiedClaims,
  TMode extends Mode = 'required',
>(options: TanStackOptions<TIdentity, TMode>): FunctionJwtMiddleware<TIdentity, TMode>;
/**
 * Pretyped broad function policies preserve all their declared auth states.
 */
export declare function jwtFunctionMiddleware<
  TIdentity = VerifiedClaims,
  TMode extends Mode = Mode,
>(options: TanStackOptions<TIdentity, TMode, Skip>): FunctionJwtMiddleware<TIdentity, TMode, Skip>;
export type { TanStackAuth, TanStackOptions };
```

## policy.d.mts

```ts
import { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import { IntegrationOptions, RequestInfoLike } from '@serverless-jwt/jwt-verifier/adapter';
/**
 * Required authentication is the default; optional mode admits missing credentials only.
 */
export type Mode = 'required' | 'optional';
/**
 * Only an explicit synchronous policy can permit an unauthenticated request.
 */
export type Skip = ((request: RequestInfoLike) => boolean) | undefined;
/**
 * Native middleware context preserves precisely the identity and enabled missing/skip states.
 */
export type TanStackAuth<
  TIdentity,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> =
  | Auth<TIdentity>
  | (TMode extends 'optional' ? null : never)
  | (TSkip extends undefined ? never : undefined);
/**
 * Request and function callbacks share the same original native Request error boundary.
 */
export type TanStackOptions<
  TIdentity = VerifiedClaims,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = IntegrationOptions<TIdentity> & {
  /**
   * Invalid credentials reject regardless of missing-credential policy.
   */
  readonly mode?: TMode;
  /**
   * Deliberately skipped requests continue with undefined auth.
   */
  readonly skip?: TSkip;
  /**
   * Return undefined for the default; preserve no-store on platform-owned custom responses.
   */
  readonly onError?: (
    error: JwtVerifierError,
    request: Request,
  ) => Response | undefined | Promise<Response | undefined>;
};
```
