import type { Auth, HttpError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type { IntegrationOptions } from '@serverless-jwt/jwt-verifier/adapter';
import type { APIContext, MiddlewareNext } from 'astro';

import { JwtVerifierError } from '@serverless-jwt/jwt-verifier';
import {
  authorizationFromHeaders,
  createGuard,
  toResponse,
} from '@serverless-jwt/jwt-verifier/adapter';

import { registeredPolicy } from '#serverless-jwt-astro-policy';

import { assertRegistration, matchesPath, routingPath, validatePatterns } from './protection.ts';

declare global {
  /**
   * Global framework locals cannot promise any one factory's identity type or mode.
   */
  namespace App {
    /**
     * Auth exists only on the current request and must be checked before use.
     */
    interface Locals {
      /**
       * Required, optional, skipped and unprotected handles share this honest global boundary.
       */
      readonly auth?: Auth<unknown> | null | undefined;
    }
  }
}

/**
 * Authentication and explicitly registered path protection for a composable server hook.
 */
export type JwtMiddlewareOptions<TIdentity = VerifiedClaims> = IntegrationOptions<TIdentity> & {
  /**
   * Deployment paths use exact literals or terminal /**; predicates require explicit predicate
   * registration.
   */
  readonly protect: ReadonlyArray<string> | ((context: APIContext) => boolean);
  /**
   * A custom uncommitted response may replace authentication failure; undefined uses the default.
   */
  readonly onError?: (
    error: JwtVerifierError,
    context: APIContext,
  ) => Response | undefined | Promise<Response | undefined>;
};

/**
 * Identifies only this endpoint guard's missing credentials so ordinary route errors propagate.
 */
class EndpointAuthenticationRequired extends JwtVerifierError {
  /**
   * Uses the canonical missing-token response rather than a checked-accessor programming error.
   */
  constructor() {
    super('missing_token');
  }
}

/**
 * Returns checked request auth; application-owned identity types never leak into global
 * declarations. The installed middleware supplies a bare-challenge 401 for absent endpoint auth.
 */
export function requireAuth<TIdentity = unknown>(locals: App.Locals): Auth<TIdentity> {
  if (locals.auth === null || locals.auth === undefined) {
    throw new EndpointAuthenticationRequired();
  }

  return locals.auth as Auth<TIdentity>;
}

/**
 * Constructs one verifier only after validating the mandatory immutable build/runtime policy
 * bridge.
 */
export function jwtMiddleware<TIdentity = VerifiedClaims>(
  options: JwtMiddlewareOptions<TIdentity>,
): (context: APIContext, next: MiddlewareNext) => Promise<Response> {
  const protect = options?.protect;
  const patterns = typeof protect === 'function' ? undefined : validatePatterns(protect);
  assertRegistration(
    registeredPolicy,
    patterns ? { kind: 'patterns', patterns } : { kind: 'predicate' },
  );
  const guard = createGuard(options);
  /**
   * Snapshots the validated public realm; existing-verifier mode keeps the guard default.
   */
  const endpointFailure = new JwtVerifierError(
    'missing_token',
    options.realm === undefined ? {} : { realm: options.realm },
  );
  const { onError } = options;
  /**
   * Applies only the authentication error hook; downstream downstream exceptions remain
   * platform-owned.
   */
  const reject = async (
    failure: JwtVerifierError,
    context: APIContext,
    http: HttpError = failure.toHttp(),
  ): Promise<Response> => {
    if (onError) {
      try {
        const response = await onError(failure, context);
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

    return toResponse(http);
  };
  return async (context: APIContext, next): Promise<Response> => {
    Object.assign(context.locals, { auth: undefined });
    /**
     * Converts only an explicit endpoint guard rejection, including intentionally unprotected
     * paths.
     */
    const resolve = async (): Promise<Response> => {
      try {
        return await next();
      } catch (failure) {
        if (failure instanceof EndpointAuthenticationRequired) {
          return reject(endpointFailure, context);
        }

        throw failure;
      }
    };
    let protectedRequest: boolean;
    if (patterns) {
      let pathname: string;
      try {
        pathname = routingPath(context.url.pathname);
      } catch {
        return new Response('Invalid request pathname.', {
          status: 400,
          headers: { 'cache-control': 'no-store' },
        });
      }

      protectedRequest = matchesPath(pathname, patterns);
    } else {
      try {
        protectedRequest = (protect as (context: APIContext) => boolean)(context);
      } catch (cause) {
        return reject(new JwtVerifierError('adapter_misconfigured', { cause }), context);
      }
    }

    if (typeof protectedRequest !== 'boolean') {
      void Promise.resolve(protectedRequest).catch(() => {});
      return reject(new JwtVerifierError('adapter_misconfigured'), context);
    }

    if (!protectedRequest) {
      return resolve();
    }

    const decision = await guard.decide(
      {
        method: context.request.method,
        url: context.url.href,
        authorization: authorizationFromHeaders(context.request.headers),
        header: (name: string): string | undefined =>
          context.request.headers.get(name) ?? undefined,
      },
      context.request.signal,
    );
    if (decision.kind === 'reject') {
      return reject(decision.error, context, decision.http);
    }

    Object.assign(context.locals, { auth: decision.kind === 'skip' ? undefined : decision.auth });
    return resolve();
  };
}
