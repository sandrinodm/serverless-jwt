# @serverless-jwt/netlify/v1

Generated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.

## v1.d.mts

```ts
import { HandlerContext, HandlerEvent, HandlerResponse } from '@netlify/functions';
import { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import { IntegrationOptions, RequestInfoLike } from '@serverless-jwt/jwt-verifier/adapter';
/**
 * Missing credentials are rejected unless optional mode is selected.
 */
type Mode = 'required' | 'optional';
/**
 * Only a deliberately configured synchronous skip allows undefined authentication.
 */
type Skip = ((request: RequestInfoLike) => boolean) | undefined;
/**
 * Preserves the exact states enabled by the wrapper's policy.
 */
export type LambdaAuth<
  TIdentity,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> =
  | Auth<TIdentity>
  | (TMode extends 'optional' ? null : never)
  | (TSkip extends undefined ? never : undefined);
/**
 * Promise-only downstream handlers retain the original event and context without mutation.
 */
export type LambdaHandler<
  TEvent,
  TResult,
  TIdentity,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = (
  event: TEvent,
  context: HandlerContext,
  auth: LambdaAuth<TIdentity, TMode, TSkip>,
) => Promise<TResult>;
/**
 * Each ingress has an awaited error hook returning its own result shape.
 */
export type LambdaOptions<
  TEvent,
  TResult,
  TIdentity = VerifiedClaims,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = IntegrationOptions<TIdentity> & {
  /**
   * Required by default; optional missing credentials produce null.
   */
  readonly mode?: TMode;
  /**
   * Supplies caller-owned cancellation because the native invocation context has no AbortSignal.
   */
  readonly getSignal?: (event: TEvent, context: HandlerContext) => AbortSignal | undefined;
  /**
   * Explicit unauthenticated pass-through; invalid predicates fail closed.
   */
  readonly skip?: TSkip;
  /**
   * Undefined uses the safe default; custom results should retain no-store.
   */
  readonly onError?: (
    error: JwtVerifierError,
    event: TEvent,
    context: HandlerContext,
  ) => TResult | undefined | Promise<TResult | undefined>;
};
/**
 * Explicit skip handlers receive undefined for deliberately unguarded requests.
 *
 * @deprecated Netlify Lambda compatibility stops on 2027-07-01; migrate to the root v2 entry.
 *   Removed in 2.0.
 */
export declare function withJwt<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: LambdaOptions<
    HandlerEvent,
    HandlerResponse,
    TIdentity,
    TMode,
    (request: RequestInfoLike) => boolean
  > & {
    readonly skip: (request: RequestInfoLike) => boolean;
  },
  handler: LambdaHandler<
    HandlerEvent,
    HandlerResponse,
    TIdentity,
    TMode,
    (request: RequestInfoLike) => boolean
  >,
): (event: HandlerEvent, context: HandlerContext) => Promise<HandlerResponse>;
/**
 * Required handlers retain nonnullable Auth unless optional mode is selected.
 *
 * @deprecated Netlify Lambda compatibility stops on 2027-07-01; migrate to the root v2 entry.
 *   Removed in 2.0.
 */
export declare function withJwt<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: LambdaOptions<HandlerEvent, HandlerResponse, TIdentity, TMode, undefined>,
  handler: LambdaHandler<HandlerEvent, HandlerResponse, TIdentity, TMode, undefined>,
): (event: HandlerEvent, context: HandlerContext) => Promise<HandlerResponse>;
/**
 * Broad pretyped policies preserve all authentication states enabled by the caller.
 *
 * @deprecated Netlify Lambda compatibility stops on 2027-07-01; migrate to the root v2 entry.
 *   Removed in 2.0.
 */
export declare function withJwt<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: LambdaOptions<HandlerEvent, HandlerResponse, TIdentity, TMode, Skip>,
  handler: LambdaHandler<HandlerEvent, HandlerResponse, TIdentity, TMode, Skip>,
): (event: HandlerEvent, context: HandlerContext) => Promise<HandlerResponse>;
export {};
```
