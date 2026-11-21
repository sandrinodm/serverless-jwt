import type { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type { IntegrationOptions, RequestInfoLike } from '@serverless-jwt/jwt-verifier/adapter';
import type { Context, MiddlewareHandler } from 'hono';

import {
  authorizationFromHeaders,
  createGuard,
  toResponse,
} from '@serverless-jwt/jwt-verifier/adapter';

/**
 * Authentication mode controls missing-credential state.
 */
type Mode = 'required' | 'optional';
/**
 * An explicit synchronous skip permits unauthenticated access.
 */
type Skip = ((request: RequestInfoLike) => boolean) | undefined;

/**
 * Hono's app-owned environment preserves the factory's identity, mode and skip states.
 */
export interface JwtEnv<
  TIdentity = VerifiedClaims,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> {
  /**
   * Variables belong only to the current Hono request context.
   */
  readonly Variables: {
    /**
     * Required auth, optional missing null, or explicit skip undefined.
     */
    readonly auth:
      | Auth<TIdentity>
      | (TMode extends 'optional' ? null : never)
      | (TSkip extends undefined ? never : undefined);
  };
}

/**
 * Hono policy with an awaited platform-owned rejection hook.
 */
export type HonoOptions<
  TIdentity = VerifiedClaims,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = IntegrationOptions<TIdentity> & {
  /**
   * Required by default; invalid tokens always reject.
   */
  readonly mode?: TMode;
  /**
   * Deliberately permits unauthenticated access for matching request views.
   */
  readonly skip?: TSkip;
  /**
   * Undefined uses the default; custom responses should retain no-store.
   */
  readonly onError?: (
    error: JwtVerifierError,
    context: Context<JwtEnv<TIdentity, TMode, Skip>>,
  ) => Response | undefined | Promise<Response | undefined>;
};

/**
 * Explicit skip middleware advertises undefined in its request-owned auth variable.
 */
export function jwt<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: HonoOptions<TIdentity, TMode, (request: RequestInfoLike) => boolean> & {
    readonly skip: (request: RequestInfoLike) => boolean;
  },
): MiddlewareHandler<JwtEnv<TIdentity, TMode, (request: RequestInfoLike) => boolean>>;

/**
 * Required-by-default middleware preserves nonnullable mapped identity.
 */
export function jwt<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: HonoOptions<TIdentity, TMode>,
): MiddlewareHandler<JwtEnv<TIdentity, TMode>>;

/**
 * Pretyped broad policies preserve every enabled auth state.
 */
export function jwt<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: HonoOptions<TIdentity, TMode, Skip>,
): MiddlewareHandler<JwtEnv<TIdentity, TMode, Skip>>;

/**
 * Creates one verifier at module scope and calls downstream middleware outside authentication
 * catches.
 */
export function jwt<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: HonoOptions<TIdentity, TMode, Skip>,
): MiddlewareHandler<JwtEnv<TIdentity, TMode>> | MiddlewareHandler<JwtEnv<TIdentity, TMode, Skip>> {
  const guard = createGuard<TIdentity, TMode>(options);
  const { onError } = options;
  /**
   * Keeps auth and response finalization on the original Hono context for this request only.
   */
  const middleware: MiddlewareHandler<JwtEnv<TIdentity, TMode, Skip>> = async (
    context,
    next,
  ): Promise<Response | void> => {
    context.set('auth', undefined);
    const request = context.req.raw;
    const decision = await guard.decide(
      {
        method: request.method,
        url: request.url,
        authorization: authorizationFromHeaders(request.headers),
        header: (name: string): string | undefined => request.headers.get(name) ?? undefined,
      },
      request.signal,
    );
    if (decision.kind === 'reject') {
      if (onError) {
        try {
          const response = await onError(decision.error, context);
          if (response !== undefined) {
            if (!(response instanceof Response) || response.bodyUsed || response.body?.locked) {
              throw new Error('Unusable custom response');
            }

            return context.finalized ? context.res : response;
          }
        } catch {
          guard.reportErrorHookFailure();
        }
      }

      return context.finalized ? context.res : toResponse(decision.http);
    }

    context.set(
      'auth',
      (decision.kind === 'skip' ? undefined : decision.auth) as JwtEnv<
        TIdentity,
        TMode,
        Skip
      >['Variables']['auth'],
    );
    await next();
  };
  return middleware;
}
