# @serverless-jwt/aws-lambda

Generated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.

## index.d.mts

```ts
import { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import { IntegrationOptions, RequestInfoLike } from '@serverless-jwt/jwt-verifier/adapter';
import {
  ALBEvent,
  ALBResult,
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResult,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';
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
  context: Context,
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
  readonly getSignal?: (event: TEvent, context: Context) => AbortSignal | undefined;
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
    context: Context,
  ) => TResult | undefined | Promise<TResult | undefined>;
};
/**
 * ALB requires target-group multi-value headers unless the loss is explicitly accepted.
 */
export type AlbOptions<
  TIdentity = VerifiedClaims,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = LambdaOptions<ALBEvent, ALBResult, TIdentity, TMode, TSkip> & {
  /**
   * Single-value mode cannot detect duplicate credentials and must be explicitly selected.
   */
  readonly albHeaders?: 'multi-value' | 'single-value';
};
/**
 * Explicit skip handlers receive undefined for deliberately unguarded requests.
 */
declare function apiGatewayV1<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: LambdaOptions<
    APIGatewayProxyEvent,
    APIGatewayProxyResult,
    TIdentity,
    TMode,
    (request: RequestInfoLike) => boolean
  > & {
    readonly skip: (request: RequestInfoLike) => boolean;
  },
  handler: LambdaHandler<
    APIGatewayProxyEvent,
    APIGatewayProxyResult,
    TIdentity,
    TMode,
    (request: RequestInfoLike) => boolean
  >,
): (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;
/**
 * Required handlers retain nonnullable Auth unless optional mode is selected.
 */
declare function apiGatewayV1<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: LambdaOptions<APIGatewayProxyEvent, APIGatewayProxyResult, TIdentity, TMode, undefined>,
  handler: LambdaHandler<APIGatewayProxyEvent, APIGatewayProxyResult, TIdentity, TMode, undefined>,
): (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;
/**
 * Broad pretyped policies preserve all authentication states enabled by the caller.
 */
declare function apiGatewayV1<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: LambdaOptions<APIGatewayProxyEvent, APIGatewayProxyResult, TIdentity, TMode, Skip>,
  handler: LambdaHandler<APIGatewayProxyEvent, APIGatewayProxyResult, TIdentity, TMode, Skip>,
): (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;
/**
 * Explicit skip handlers receive undefined for deliberately unguarded requests.
 */
declare function apiGatewayV2<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: LambdaOptions<
    APIGatewayProxyEventV2,
    APIGatewayProxyStructuredResultV2,
    TIdentity,
    TMode,
    (request: RequestInfoLike) => boolean
  > & {
    readonly skip: (request: RequestInfoLike) => boolean;
  },
  handler: LambdaHandler<
    APIGatewayProxyEventV2,
    APIGatewayProxyStructuredResultV2,
    TIdentity,
    TMode,
    (request: RequestInfoLike) => boolean
  >,
): (event: APIGatewayProxyEventV2, context: Context) => Promise<APIGatewayProxyStructuredResultV2>;
/**
 * Required handlers retain nonnullable Auth unless optional mode is selected.
 */
declare function apiGatewayV2<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: LambdaOptions<
    APIGatewayProxyEventV2,
    APIGatewayProxyStructuredResultV2,
    TIdentity,
    TMode,
    undefined
  >,
  handler: LambdaHandler<
    APIGatewayProxyEventV2,
    APIGatewayProxyStructuredResultV2,
    TIdentity,
    TMode,
    undefined
  >,
): (event: APIGatewayProxyEventV2, context: Context) => Promise<APIGatewayProxyStructuredResultV2>;
/**
 * Broad pretyped policies preserve all authentication states enabled by the caller.
 */
declare function apiGatewayV2<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: LambdaOptions<
    APIGatewayProxyEventV2,
    APIGatewayProxyStructuredResultV2,
    TIdentity,
    TMode,
    Skip
  >,
  handler: LambdaHandler<
    APIGatewayProxyEventV2,
    APIGatewayProxyStructuredResultV2,
    TIdentity,
    TMode,
    Skip
  >,
): (event: APIGatewayProxyEventV2, context: Context) => Promise<APIGatewayProxyStructuredResultV2>;
/**
 * Explicit skip handlers receive undefined for deliberately unguarded requests.
 */
declare function alb<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: AlbOptions<TIdentity, TMode, (request: RequestInfoLike) => boolean> & {
    readonly skip: (request: RequestInfoLike) => boolean;
  },
  handler: LambdaHandler<
    ALBEvent,
    ALBResult,
    TIdentity,
    TMode,
    (request: RequestInfoLike) => boolean
  >,
): (event: ALBEvent, context: Context) => Promise<ALBResult>;
/**
 * Required handlers retain nonnullable Auth unless optional mode is selected.
 */
declare function alb<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: AlbOptions<TIdentity, TMode, undefined>,
  handler: LambdaHandler<ALBEvent, ALBResult, TIdentity, TMode, undefined>,
): (event: ALBEvent, context: Context) => Promise<ALBResult>;
/**
 * Broad pretyped policies preserve all authentication states enabled by the caller.
 */
declare function alb<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: AlbOptions<TIdentity, TMode, Skip>,
  handler: LambdaHandler<ALBEvent, ALBResult, TIdentity, TMode, Skip>,
): (event: ALBEvent, context: Context) => Promise<ALBResult>;
/**
 * Explicit ingress factories avoid guessing an event's security-sensitive header semantics.
 */
export declare const withJwt: {
  readonly apiGatewayV1: typeof apiGatewayV1;
  readonly apiGatewayV2: typeof apiGatewayV2;
  readonly alb: typeof alb;
};
export {};
```
