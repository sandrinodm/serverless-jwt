import type { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type { IntegrationOptions } from '@serverless-jwt/jwt-verifier/adapter';
import type { MiddlewareFunction, RouterContext } from 'react-router';

import { ConfigurationError } from '@serverless-jwt/jwt-verifier';
import {
  authorizationFromHeaders,
  createGuard,
  toResponse,
} from '@serverless-jwt/jwt-verifier/adapter';
import { createContext } from 'react-router';

/**
 * Application-owned context includes optional and deliberately skipped request states.
 */
export type AuthContext<TIdentity> = Readonly<RouterContext<Auth<TIdentity> | null | undefined>>;

/**
 * Creates an independent framework context whose value belongs only to the current request.
 */
export function createAuthContext<TIdentity = VerifiedClaims>(): AuthContext<TIdentity> {
  return Object.freeze(createContext<Auth<TIdentity> | null | undefined>());
}

/**
 * A required application context keeps independently typed integrations from sharing global state.
 */
export type ReactRouterOptions<TIdentity = VerifiedClaims> = IntegrationOptions<TIdentity> & {
  /**
   * Pass the same application-owned context to loaders and this middleware factory.
   */
  readonly context: AuthContext<TIdentity>;

  /**
   * Authentication failures can return a platform response before downstream middleware runs.
   */
  readonly onError?: (
    error: JwtVerifierError,
    args: Parameters<MiddlewareFunction>[0],
  ) => Response | undefined | Promise<Response | undefined>;
};

/**
 * Verifies once per request, stores auth on the native context, and preserves downstream results.
 */
export function jwtMiddleware<TIdentity = VerifiedClaims>(
  options: ReactRouterOptions<TIdentity>,
): MiddlewareFunction<Response> {
  const { context, onError } = options;
  if (!context || typeof context !== 'object') {
    throw new ConfigurationError('React Router auth context is required');
  }

  const guard = createGuard(options);
  return async (args, next): Promise<Response> => {
    args.context.set(context, undefined);
    const decision = await guard.decide(
      {
        method: args.request.method,
        url: args.request.url,
        authorization: authorizationFromHeaders(args.request.headers),
        header: (name: string): string | undefined => args.request.headers.get(name) ?? undefined,
      },
      args.request.signal,
    );
    if (decision.kind === 'reject') {
      if (onError) {
        try {
          const response = await onError(decision.error, args);
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

    args.context.set(context, decision.kind === 'skip' ? undefined : decision.auth);
    return next();
  };
}
