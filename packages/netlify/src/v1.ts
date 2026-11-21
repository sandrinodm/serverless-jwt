import type { HandlerEvent, HandlerContext, HandlerResponse } from '@netlify/functions';
import type { Auth, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type { IntegrationOptions, RequestInfoLike } from '@serverless-jwt/jwt-verifier/adapter';

import { JwtVerifierError } from '@serverless-jwt/jwt-verifier';
import { authorizationFromLambdaEvent, createGuard } from '@serverless-jwt/jwt-verifier/adapter';

import { isUsableResult } from './v1-result.ts';

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
 * Creates the shape-specific wrapper without catching downstream handler errors.
 */
function wrap<
  TEvent extends HandlerEvent,
  TResult extends HandlerResponse,
  TIdentity,
  TMode extends Mode,
  TSkip extends Skip,
>(
  options: LambdaOptions<TEvent, TResult, TIdentity, TMode, TSkip>,
  handler: LambdaHandler<TEvent, TResult, TIdentity, TMode, TSkip>,
): (event: TEvent, context: HandlerContext) => Promise<TResult> {
  if (options.getSignal !== undefined && typeof options.getSignal !== 'function') {
    throw new JwtVerifierError('adapter_misconfigured');
  }

  const guard = createGuard<TIdentity, TMode>(options);
  const { onError, getSignal } = options;
  return async (event, context): Promise<TResult> => {
    let failure: JwtVerifierError | undefined;
    let signal: AbortSignal | undefined;
    let authorization: ReadonlyArray<string> = [];
    try {
      const supplied: unknown = getSignal?.(event, context);
      if (supplied !== undefined && !(supplied instanceof AbortSignal)) {
        void Promise.resolve(supplied).catch(() => {});
        throw new JwtVerifierError('adapter_misconfigured');
      }

      signal = supplied;
      authorization = authorizationFromLambdaEvent(
        {
          headers: event.headers ?? null,
          multiValueHeaders:
            'multiValueHeaders' in event ? (event.multiValueHeaders ?? null) : null,
        },
        'apiGatewayV1',
      );
    } catch (cause) {
      guard.reportMisconfiguration();
      failure =
        cause instanceof JwtVerifierError
          ? cause
          : new JwtVerifierError('adapter_misconfigured', { cause });
    }

    const method = event.httpMethod;
    const url = event.path;
    const decision = failure
      ? { kind: 'reject' as const, error: failure, http: failure.toHttp() }
      : await guard.decide(
          {
            method,
            url,
            authorization,
            header: (name: string): string | undefined =>
              Object.entries(event.headers ?? {}).find(
                ([key]) => key.toLowerCase() === name.toLowerCase(),
              )?.[1],
          },
          signal,
        );
    if (decision.kind === 'reject') {
      if (onError) {
        try {
          const result = await onError(decision.error, event, context);
          if (result !== undefined) {
            if (!isUsableResult(result)) {
              throw new Error('Unusable custom response');
            }

            return result;
          }
        } catch {
          guard.reportErrorHookFailure();
        }
      }

      return {
        statusCode: decision.http.status,
        headers: decision.http.headers,
        body: JSON.stringify(decision.http.body),
        isBase64Encoded: false,
      } as unknown as TResult;
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
 *
 * @deprecated Netlify Lambda compatibility stops on 2027-07-01; migrate to the root v2 entry.
 *   Removed in 2.0.
 */
export function withJwt<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: LambdaOptions<
    HandlerEvent,
    HandlerResponse,
    TIdentity,
    TMode,
    (request: RequestInfoLike) => boolean
  > & { readonly skip: (request: RequestInfoLike) => boolean },
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
export function withJwt<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: LambdaOptions<HandlerEvent, HandlerResponse, TIdentity, TMode, undefined>,
  handler: LambdaHandler<HandlerEvent, HandlerResponse, TIdentity, TMode, undefined>,
): (event: HandlerEvent, context: HandlerContext) => Promise<HandlerResponse>;

/**
 * Broad pretyped policies preserve all authentication states enabled by the caller.
 *
 * @deprecated Netlify Lambda compatibility stops on 2027-07-01; migrate to the root v2 entry.
 *   Removed in 2.0.
 */
export function withJwt<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: LambdaOptions<HandlerEvent, HandlerResponse, TIdentity, TMode, Skip>,
  handler: LambdaHandler<HandlerEvent, HandlerResponse, TIdentity, TMode, Skip>,
): (event: HandlerEvent, context: HandlerContext) => Promise<HandlerResponse>;

/**
 * Protects transitional Netlify Lambda-compatible functions using an explicit auth argument.
 *
 * @deprecated Netlify Lambda compatibility stops on 2027-07-01; migrate to the root v2 entry.
 *   Removed in 2.0.
 */
export function withJwt<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: LambdaOptions<HandlerEvent, HandlerResponse, TIdentity, TMode, Skip>,
  handler:
    | LambdaHandler<HandlerEvent, HandlerResponse, TIdentity, TMode, undefined>
    | LambdaHandler<HandlerEvent, HandlerResponse, TIdentity, TMode, Skip>,
): (event: HandlerEvent, context: HandlerContext) => Promise<HandlerResponse> {
  return wrap(
    options,
    handler as LambdaHandler<HandlerEvent, HandlerResponse, TIdentity, TMode, Skip>,
  );
}
