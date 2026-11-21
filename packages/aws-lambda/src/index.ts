import type { Auth, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type {
  IntegrationOptions,
  LambdaEventLike,
  RequestInfoLike,
} from '@serverless-jwt/jwt-verifier/adapter';
import type {
  ALBEvent,
  ALBResult,
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResult,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';

import { JwtVerifierError } from '@serverless-jwt/jwt-verifier';
import { authorizationFromLambdaEvent, createGuard } from '@serverless-jwt/jwt-verifier/adapter';

import { isUsableResult } from './result.ts';

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
 * Creates the shape-specific wrapper without catching downstream handler errors.
 */
function wrap<
  TEvent extends APIGatewayProxyEvent | APIGatewayProxyEventV2 | ALBEvent,
  TResult extends APIGatewayProxyResult | APIGatewayProxyStructuredResultV2 | ALBResult,
  TIdentity,
  TMode extends Mode,
  TSkip extends Skip,
>(
  options: LambdaOptions<TEvent, TResult, TIdentity, TMode, TSkip>,
  handler: LambdaHandler<TEvent, TResult, TIdentity, TMode, TSkip>,
  shape: 'apiGatewayV1' | 'apiGatewayV2' | 'albMultiValue' | 'albSingleValue',
): (event: TEvent, context: Context) => Promise<TResult> {
  if (options.getSignal !== undefined && typeof options.getSignal !== 'function') {
    throw new JwtVerifierError('adapter_misconfigured');
  }

  const guard = createGuard<TIdentity, TMode>(options);
  const { onError, getSignal } = options;
  return async (event, context): Promise<TResult> => {
    let failure: JwtVerifierError | undefined;
    let signal: AbortSignal | undefined;
    let headers: LambdaEventLike = {};
    let authorization: ReadonlyArray<string> = [];
    try {
      const supplied: unknown = getSignal?.(event, context);
      if (supplied !== undefined && !(supplied instanceof AbortSignal)) {
        void Promise.resolve(supplied).catch(() => {});
        throw new JwtVerifierError('adapter_misconfigured');
      }

      signal = supplied;
      headers = {
        headers: event.headers ?? null,
        multiValueHeaders: 'multiValueHeaders' in event ? (event.multiValueHeaders ?? null) : null,
      };
      authorization = authorizationFromLambdaEvent(headers, shape);
    } catch (cause) {
      guard.reportMisconfiguration();
      failure =
        cause instanceof JwtVerifierError
          ? cause
          : new JwtVerifierError('adapter_misconfigured', { cause });
    }

    const method = 'httpMethod' in event ? event.httpMethod : event.requestContext.http.method;
    const url = 'rawPath' in event ? event.rawPath : event.path;
    const multiValueHeaders = shape === 'albMultiValue' ? headers.multiValueHeaders : null;
    const decision = failure
      ? { kind: 'reject' as const, error: failure, http: failure.toHttp() }
      : await guard.decide(
          {
            method,
            url,
            authorization,
            header: (name: string): string | undefined => {
              const lowerName = name.toLowerCase();
              if (multiValueHeaders) {
                const values = Object.entries(multiValueHeaders).flatMap(([key, entries]) =>
                  key.toLowerCase() === lowerName ? (entries ?? []) : [],
                );
                return values.length > 0 ? values.join(', ') : undefined;
              }

              return Object.entries(headers.headers ?? {}).find(
                ([key]) => key.toLowerCase() === lowerName,
              )?.[1];
            },
          },
          signal,
        );
    if (decision.kind === 'reject') {
      if (onError) {
        try {
          const result = await onError(decision.error, event, context);
          if (result !== undefined) {
            if (!isUsableResult(result, shape)) {
              throw new Error('Unusable custom response');
            }

            return result;
          }
        } catch {
          guard.reportErrorHookFailure();
        }
      }

      const headers =
        shape === 'albMultiValue'
          ? {
              multiValueHeaders: Object.fromEntries(
                Object.entries(decision.http.headers).map(([name, value]) => [name, [value]]),
              ),
            }
          : { headers: decision.http.headers };
      return {
        statusCode: decision.http.status,
        ...headers,
        body: JSON.stringify(decision.http.body),
        isBase64Encoded: false,
      } as TResult;
    }

    return handler(
      event,
      context,
      (decision.kind === 'skip' ? undefined : decision.auth) as LambdaAuth<TIdentity, TMode, TSkip>,
    );
  };
}

/**
 * Explicit skip handlers receive undefined for deliberately unguarded requests.
 */
function apiGatewayV1<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: LambdaOptions<
    APIGatewayProxyEvent,
    APIGatewayProxyResult,
    TIdentity,
    TMode,
    (request: RequestInfoLike) => boolean
  > & { readonly skip: (request: RequestInfoLike) => boolean },
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
function apiGatewayV1<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: LambdaOptions<APIGatewayProxyEvent, APIGatewayProxyResult, TIdentity, TMode, undefined>,
  handler: LambdaHandler<APIGatewayProxyEvent, APIGatewayProxyResult, TIdentity, TMode, undefined>,
): (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;

/**
 * Broad pretyped policies preserve all authentication states enabled by the caller.
 */
function apiGatewayV1<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: LambdaOptions<APIGatewayProxyEvent, APIGatewayProxyResult, TIdentity, TMode, Skip>,
  handler: LambdaHandler<APIGatewayProxyEvent, APIGatewayProxyResult, TIdentity, TMode, Skip>,
): (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;

/**
 * API Gateway REST API preserves authoritative multiValueHeaders.
 */
function apiGatewayV1<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: LambdaOptions<APIGatewayProxyEvent, APIGatewayProxyResult, TIdentity, TMode, Skip>,
  handler:
    | LambdaHandler<APIGatewayProxyEvent, APIGatewayProxyResult, TIdentity, TMode, undefined>
    | LambdaHandler<APIGatewayProxyEvent, APIGatewayProxyResult, TIdentity, TMode, Skip>,
): (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult> {
  return wrap(
    options,
    handler as LambdaHandler<APIGatewayProxyEvent, APIGatewayProxyResult, TIdentity, TMode, Skip>,
    'apiGatewayV1',
  );
}
/**
 * Explicit skip handlers receive undefined for deliberately unguarded requests.
 */
function apiGatewayV2<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: LambdaOptions<
    APIGatewayProxyEventV2,
    APIGatewayProxyStructuredResultV2,
    TIdentity,
    TMode,
    (request: RequestInfoLike) => boolean
  > & { readonly skip: (request: RequestInfoLike) => boolean },
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
function apiGatewayV2<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
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
function apiGatewayV2<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
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
 * HTTP APIs and Function URLs reject comma-joined credentials.
 */
function apiGatewayV2<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: LambdaOptions<
    APIGatewayProxyEventV2,
    APIGatewayProxyStructuredResultV2,
    TIdentity,
    TMode,
    Skip
  >,
  handler:
    | LambdaHandler<
        APIGatewayProxyEventV2,
        APIGatewayProxyStructuredResultV2,
        TIdentity,
        TMode,
        undefined
      >
    | LambdaHandler<
        APIGatewayProxyEventV2,
        APIGatewayProxyStructuredResultV2,
        TIdentity,
        TMode,
        Skip
      >,
): (event: APIGatewayProxyEventV2, context: Context) => Promise<APIGatewayProxyStructuredResultV2> {
  return wrap(
    options,
    handler as LambdaHandler<
      APIGatewayProxyEventV2,
      APIGatewayProxyStructuredResultV2,
      TIdentity,
      TMode,
      Skip
    >,
    'apiGatewayV2',
  );
}
/**
 * Explicit skip handlers receive undefined for deliberately unguarded requests.
 */
function alb<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
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
function alb<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: AlbOptions<TIdentity, TMode, undefined>,
  handler: LambdaHandler<ALBEvent, ALBResult, TIdentity, TMode, undefined>,
): (event: ALBEvent, context: Context) => Promise<ALBResult>;

/**
 * Broad pretyped policies preserve all authentication states enabled by the caller.
 */
function alb<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: AlbOptions<TIdentity, TMode, Skip>,
  handler: LambdaHandler<ALBEvent, ALBResult, TIdentity, TMode, Skip>,
): (event: ALBEvent, context: Context) => Promise<ALBResult>;

/**
 * ALB requires multi-value headers by default and serializes only the selected header mode.
 */
function alb<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: AlbOptions<TIdentity, TMode, Skip>,
  handler:
    | LambdaHandler<ALBEvent, ALBResult, TIdentity, TMode, undefined>
    | LambdaHandler<ALBEvent, ALBResult, TIdentity, TMode, Skip>,
): (event: ALBEvent, context: Context) => Promise<ALBResult> {
  if (
    options.albHeaders !== undefined &&
    options.albHeaders !== 'multi-value' &&
    options.albHeaders !== 'single-value'
  ) {
    throw new JwtVerifierError('adapter_misconfigured');
  }

  return wrap(
    options,
    handler as LambdaHandler<ALBEvent, ALBResult, TIdentity, TMode, Skip>,
    options.albHeaders === 'single-value' ? 'albSingleValue' : 'albMultiValue',
  );
}
/**
 * Explicit ingress factories avoid guessing an event's security-sensitive header semantics.
 */
export const withJwt: {
  readonly apiGatewayV1: typeof apiGatewayV1;
  readonly apiGatewayV2: typeof apiGatewayV2;
  readonly alb: typeof alb;
} = Object.freeze({ apiGatewayV1, apiGatewayV2, alb });
