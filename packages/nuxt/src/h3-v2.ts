import type { Auth, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type { IntegrationOptions } from '@serverless-jwt/jwt-verifier/adapter';

import { JwtVerifierError } from '@serverless-jwt/jwt-verifier';
import {
  authorizationFromHeaders,
  createGuard,
  toResponse,
} from '@serverless-jwt/jwt-verifier/adapter';

import { validatePatterns, routingPath, matchesPath, evaluatePredicate } from './protection.ts';

/**
 * Structural h3 v2 event keeps this entry independent of h3 v1 declarations.
 */
export interface WebEvent {
  /**
   * Original h3 v2 Web Request, including its cancellation signal.
   */
  readonly req: Request;

  /**
   * Request-owned context shared with downstream h3 handlers.
   */
  readonly context: object;
}
/**
 * Mandatory protection captures the native event subtype while keeping h3 declaration majors
 * separate.
 */
export type NuxtOptions<
  TIdentity = VerifiedClaims,
  TEvent extends WebEvent = WebEvent,
> = IntegrationOptions<TIdentity> & {
  /**
   * Nonempty paths, terminal /** subtrees, or a synchronous predicate over the original host event.
   */
  readonly protect: ReadonlyArray<string> | ((event: TEvent) => boolean);
  /**
   * Undefined selects the default; custom responses should retain no-store.
   */
  readonly onError?: (
    error: JwtVerifierError,
    event: TEvent,
  ) => Response | undefined | Promise<Response | undefined>;
};
/**
 * Checks guarded context before narrowing the application-owned identity type.
 */
export function getAuth<TIdentity = unknown>(event: WebEvent): Auth<TIdentity> {
  const auth = (event.context as { readonly auth?: Auth<unknown> | null }).auth;
  if (auth === null || auth === undefined) {
    throw new JwtVerifierError('auth_context_missing');
  }

  return auth as Auth<TIdentity>;
}
/**
 * Captures immutable path policy and one verifier at module scope.
 */
export function jwtMiddleware<TIdentity = VerifiedClaims, TEvent extends WebEvent = WebEvent>(
  options: NuxtOptions<TIdentity, TEvent>,
): (event: TEvent) => Promise<Response | undefined> {
  const protect = options?.protect;
  const patterns = typeof protect === 'function' ? undefined : validatePatterns(protect);
  const guard = createGuard(options);
  const { onError } = options;
  /**
   * Guards protected paths without consuming the request body or catching downstream handlers.
   */
  const middleware = async (event: TEvent): Promise<Response | undefined> => {
    let policyError: JwtVerifierError | undefined;
    if (patterns) {
      let path: string;
      try {
        path = routingPath(new URL(event.req.url).pathname);
      } catch {
        return new Response('Invalid request pathname.', {
          status: 400,
          headers: { 'cache-control': 'no-store' },
        });
      }

      if (!matchesPath(path, patterns)) {
        return undefined;
      }
    } else {
      try {
        if (!evaluatePredicate(protect as (event: TEvent) => boolean, event)) {
          return undefined;
        }
      } catch (cause) {
        policyError = new JwtVerifierError('adapter_misconfigured', { cause });
      }
    }

    Object.assign(event.context, { auth: undefined });
    const decision = policyError
      ? { kind: 'reject' as const, error: policyError, http: policyError.toHttp() }
      : await guard.decide(
          {
            method: event.req.method,
            url: event.req.url,
            authorization: authorizationFromHeaders(event.req.headers),
            header: (name: string): string | undefined => event.req.headers.get(name) ?? undefined,
          },
          event.req.signal,
        );
    if (decision.kind === 'reject') {
      if (onError) {
        try {
          const response = await onError(decision.error, event);
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

    Object.assign(event.context, { auth: decision.kind === 'skip' ? undefined : decision.auth });
    return undefined;
  };
  return middleware;
}
