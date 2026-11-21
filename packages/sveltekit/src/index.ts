import type { Auth, HttpError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type { IntegrationOptions } from '@serverless-jwt/jwt-verifier/adapter';
import type { RequestEvent } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';

import { JwtVerifierError } from '@serverless-jwt/jwt-verifier';
import {
  authorizationFromHeaders,
  createGuard,
  toResponse,
} from '@serverless-jwt/jwt-verifier/adapter';
import { error } from '@sveltejs/kit';

import { registeredPolicy } from '#serverless-jwt-policy';

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
export type JwtHandleOptions<TIdentity = VerifiedClaims> = IntegrationOptions<TIdentity> & {
  /**
   * Deployment paths use exact literals or terminal /**; predicates require explicit predicate
   * registration.
   */
  readonly protect: ReadonlyArray<string> | ((event: RequestEvent) => boolean);
  /**
   * A custom uncommitted response may replace authentication failure; undefined uses the default.
   */
  readonly onError?: (
    error: JwtVerifierError,
    event: RequestEvent,
  ) => Response | undefined | Promise<Response | undefined>;
};

/**
 * Associates endpoint header writers with their current request locals, without retaining auth.
 */
const endpointHeaders: WeakMap<App.Locals, () => void> = new WeakMap();

/**
 * Returns checked request auth; application-owned identity types never leak into global
 * declarations. The installed middleware supplies a bare-challenge 401 for absent endpoint auth.
 */
export function requireAuth<TIdentity = unknown>(locals: App.Locals): Auth<TIdentity> {
  if (locals.auth === null || locals.auth === undefined) {
    endpointHeaders.get(locals)?.();
    error(401, 'Authentication required');
  }

  return locals.auth as Auth<TIdentity>;
}

/**
 * Constructs one verifier only after validating the mandatory immutable build/runtime policy
 * bridge.
 */
export function jwtHandle<TIdentity = VerifiedClaims>(
  options: JwtHandleOptions<TIdentity>,
): Handle {
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
  /**
   * Keeps native Kit response rendering while using canonical challenge and cache headers.
   */
  const endpointHttpHeaders = Object.fromEntries(
    Object.entries(endpointFailure.toHttp().headers).filter(([name]) => name !== 'content-type'),
  );
  const { onError } = options;
  /**
   * Applies only the authentication error hook; downstream resolver exceptions remain
   * platform-owned.
   */
  const reject = async (
    failure: JwtVerifierError,
    event: RequestEvent,
    http: HttpError = failure.toHttp(),
  ): Promise<Response> => {
    if (onError) {
      try {
        const response = await onError(failure, event);
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
  return async ({ event, resolve }): Promise<Response> => {
    Object.assign(event.locals, { auth: undefined });
    /**
     * Supplies native endpoint headers only while this request resolves and restores nested
     * handles.
     */
    const next = async (): Promise<Response> => {
      const previous = endpointHeaders.get(event.locals);
      endpointHeaders.set(event.locals, () => {
        event.setHeaders(endpointHttpHeaders);
      });
      try {
        return await resolve(event);
      } finally {
        if (previous) {
          endpointHeaders.set(event.locals, previous);
        } else {
          endpointHeaders.delete(event.locals);
        }
      }
    };
    let protectedRequest: boolean;
    if (patterns) {
      let pathname: string;
      try {
        pathname = routingPath(event.url.pathname);
      } catch {
        return new Response('Invalid request pathname.', {
          status: 400,
          headers: { 'cache-control': 'no-store' },
        });
      }

      protectedRequest = matchesPath(pathname, patterns);
    } else {
      try {
        protectedRequest = (protect as (event: RequestEvent) => boolean)(event);
      } catch (cause) {
        return reject(new JwtVerifierError('adapter_misconfigured', { cause }), event);
      }
    }

    if (typeof protectedRequest !== 'boolean') {
      void Promise.resolve(protectedRequest).catch(() => {});
      return reject(new JwtVerifierError('adapter_misconfigured'), event);
    }

    if (!protectedRequest) {
      return next();
    }

    const decision = await guard.decide(
      {
        method: event.request.method,
        url: event.url.href,
        authorization: authorizationFromHeaders(event.request.headers),
        header: (name: string): string | undefined => event.request.headers.get(name) ?? undefined,
      },
      event.request.signal,
    );
    if (decision.kind === 'reject') {
      return reject(decision.error, event, decision.http);
    }

    Object.assign(event.locals, { auth: decision.kind === 'skip' ? undefined : decision.auth });
    return next();
  };
}
