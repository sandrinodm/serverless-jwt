import type { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type { IntegrationOptions, RequestInfoLike } from '@serverless-jwt/jwt-verifier/adapter';

import { ConfigurationError } from '@serverless-jwt/jwt-verifier';
import {
  authorizationFromHeaders,
  createGuard,
  toResponse,
} from '@serverless-jwt/jwt-verifier/adapter';

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

/**
 * A discriminated result prevents confusing authentication state with a rejection response.
 */
type PolicyResult<TIdentity, TMode extends Mode, TSkip extends Skip> =
  | { readonly auth: TanStackAuth<TIdentity, TMode, TSkip> }
  | { readonly response: Response };

/**
 * Start's RPC transport copies a Response as its init dictionary before touching headers/body.
 * Reject the proven Nitro FastResponse status-loss behavior before constructing or using auth.
 */
function assertResponseSemantics(): void {
  const original = new Response(null, { status: 418, statusText: 'JWT response check' });
  const copied = new Response(null, original);
  copied.headers.set('x-jwt-response-check', '1');
  void copied.body;
  if (copied.status !== 418 || copied.statusText !== 'JWT response check') {
    throw new ConfigurationError('TanStack Start requires native Response semantics');
  }
}

/**
 * Constructs one guard per factory while leaving all downstream execution outside its catches.
 */
export function createPolicy<TIdentity, TMode extends Mode, TSkip extends Skip>(
  options: TanStackOptions<TIdentity, TMode, TSkip>,
): (request: Request) => Promise<PolicyResult<TIdentity, TMode, TSkip>> {
  assertResponseSemantics();
  const guard = createGuard<TIdentity, TMode>(options);
  const { onError } = options;
  return async (request: Request): Promise<PolicyResult<TIdentity, TMode, TSkip>> => {
    assertResponseSemantics();
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
          const response = await onError(decision.error, request);
          if (response !== undefined) {
            if (!(response instanceof Response) || response.bodyUsed || response.body?.locked) {
              throw new Error('Unusable custom response');
            }

            return { response };
          }
        } catch {
          guard.reportErrorHookFailure();
        }
      }

      return { response: toResponse(decision.http) };
    }

    // A skip decision is possible only when the factory supplied a skip policy; optional
    // missing credentials are possible only in optional mode. Narrow the own conditional type.
    return {
      auth: (decision.kind === 'skip' ? undefined : decision.auth) as TanStackAuth<
        TIdentity,
        TMode,
        TSkip
      >,
    };
  };
}
