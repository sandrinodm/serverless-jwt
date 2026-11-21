import type { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type { IntegrationOptions, RequestInfoLike } from '@serverless-jwt/jwt-verifier/adapter';

import {
  authorizationFromHeaders,
  createGuard,
  toResponse,
} from '@serverless-jwt/jwt-verifier/adapter';

/**
 * Missing-credential policy controls handler auth inference.
 */
type Mode = 'required' | 'optional';
/**
 * Only an explicit synchronous skip permits unauthenticated access.
 */
type Skip = ((request: RequestInfoLike) => boolean) | undefined;

/**
 * Authentication states enabled by this factory's mode and skip policy.
 */
export type VercelAuth<
  TIdentity,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> =
  | Auth<TIdentity>
  | (TMode extends 'optional' ? null : never)
  | (TSkip extends undefined ? never : undefined);

/**
 * Web-function policy preserves a platform-owned optional second context argument.
 */
export type VercelOptions<
  TIdentity = VerifiedClaims,
  TContext = unknown,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = IntegrationOptions<TIdentity> & {
  /**
   * Required by default; invalid tokens reject in either mode.
   */
  readonly mode?: TMode;
  /**
   * Deliberately permits unauthenticated requests, supplying undefined auth.
   */
  readonly skip?: TSkip;
  /**
   * Undefined selects the default; custom responses should retain no-store.
   */
  readonly onError?: (
    error: JwtVerifierError,
    request: Request,
    context: TContext | undefined,
  ) => Response | undefined | Promise<Response | undefined>;
};

/**
 * Auth always occupies the third callback slot, including when context is absent.
 */
export type JwtVercelHandler<
  TIdentity,
  TContext = unknown,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = (
  request: Request,
  context: TContext | undefined,
  auth: VercelAuth<TIdentity, TMode, TSkip>,
) => Response | Promise<Response>;

/**
 * Explicit-skip handlers admit undefined auth.
 */
export function withJwt<
  TIdentity = VerifiedClaims,
  TContext = unknown,
  TMode extends Mode = 'required',
>(
  options: VercelOptions<TIdentity, TContext, TMode, (request: RequestInfoLike) => boolean> & {
    readonly skip: (request: RequestInfoLike) => boolean;
  },
  handler: JwtVercelHandler<TIdentity, TContext, TMode, (request: RequestInfoLike) => boolean>,
): (request: Request, context?: TContext) => Promise<Response>;

/**
 * Required-by-default handlers preserve nonnullable mapped identity.
 */
export function withJwt<
  TIdentity = VerifiedClaims,
  TContext = unknown,
  TMode extends Mode = 'required',
>(
  options: VercelOptions<TIdentity, TContext, TMode>,
  handler: JwtVercelHandler<TIdentity, TContext, TMode>,
): (request: Request, context?: TContext) => Promise<Response>;

/**
 * Pretyped policies keep all declared optional and skip states.
 */
export function withJwt<TIdentity = VerifiedClaims, TContext = unknown, TMode extends Mode = Mode>(
  options: VercelOptions<TIdentity, TContext, TMode, Skip>,
  handler: JwtVercelHandler<TIdentity, TContext, TMode, Skip>,
): (request: Request, context?: TContext) => Promise<Response>;

/**
 * Creates one verifier at module scope and invokes application code outside authentication catches.
 */
export function withJwt<TIdentity = VerifiedClaims, TContext = unknown, TMode extends Mode = Mode>(
  options: VercelOptions<TIdentity, TContext, TMode, Skip>,
  handler:
    | JwtVercelHandler<TIdentity, TContext, TMode>
    | JwtVercelHandler<TIdentity, TContext, TMode, Skip>,
): (request: Request, context?: TContext) => Promise<Response> {
  const guard = createGuard<TIdentity, TMode>(options);
  const { onError } = options;
  return async (request: Request, context?: TContext): Promise<Response> => {
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
          const response = await onError(decision.error, request, context);
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

    return (handler as JwtVercelHandler<TIdentity, TContext, TMode, Skip>)(
      request,
      context,
      (decision.kind === 'skip' ? undefined : decision.auth) as VercelAuth<TIdentity, TMode, Skip>,
    );
  };
}
