import type { Auth, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type { IntegrationOptions } from '@serverless-jwt/jwt-verifier/adapter';
import type { H3Event, EventHandler } from 'h3';

import { JwtVerifierError } from '@serverless-jwt/jwt-verifier';
import {
  authorizationFromNodeRequest,
  createGuard,
  toResponse,
} from '@serverless-jwt/jwt-verifier/adapter';
import { createError, defineEventHandler, send, setResponseStatus, setResponseHeaders } from 'h3';

import { validatePatterns, nodeRoutingPath, matchesPath, evaluatePredicate } from './protection.ts';

declare module 'h3' {
  /**
   * Shared event context cannot promise any factory's identity or authentication mode.
   */
  interface H3EventContext {
    /**
     * Authentication set by middleware for the current request.
     */
    readonly auth?: Auth<unknown> | null | undefined;
  }
}
/**
 * Mandatory validated protection applies before any authentication work.
 */
export type NuxtOptions<TIdentity = VerifiedClaims> = IntegrationOptions<TIdentity> & {
  /**
   * Nonempty absolute exact paths, terminal /** subtrees, or a synchronous native event predicate.
   */
  readonly protect: ReadonlyArray<string> | ((event: H3Event) => boolean);
  /**
   * Undefined selects the default; custom responses should retain no-store.
   */
  readonly onError?: (
    error: JwtVerifierError,
    event: H3Event,
  ) => Response | undefined | Promise<Response | undefined>;
};
/**
 * Checks guarded context before narrowing the application-owned identity type.
 */
export function getAuth<TIdentity = unknown>(event: H3Event): Auth<TIdentity> {
  if (event.context.auth === null || event.context.auth === undefined) {
    throw new JwtVerifierError('auth_context_missing');
  }

  return event.context.auth as Auth<TIdentity>;
}
/**
 * Captures immutable path policy and one verifier at module scope.
 */
export function jwtMiddleware<TIdentity = VerifiedClaims>(
  options: NuxtOptions<TIdentity>,
): EventHandler {
  const protect = options?.protect;
  const patterns = typeof protect === 'function' ? undefined : validatePatterns(protect);
  const guard = createGuard(options);
  const { onError } = options;
  /**
   * Guards protected paths without consuming the request body or catching downstream handlers.
   */
  const middleware = async (event: H3Event): Promise<void> => {
    let policyError: JwtVerifierError | undefined;
    if (patterns) {
      let path: string;
      try {
        path = nodeRoutingPath(event.node.req.url ?? '/');
      } catch {
        await sendResponse(
          event,
          new Response('Invalid request pathname.', {
            status: 400,
            headers: { 'cache-control': 'no-store' },
          }),
        );
        return;
      }

      if (!matchesPath(path, patterns)) {
        return;
      }
    } else {
      try {
        if (!evaluatePredicate(protect as (event: H3Event) => boolean, event)) {
          return;
        }
      } catch (cause) {
        policyError = new JwtVerifierError('adapter_misconfigured', { cause });
      }
    }

    Object.assign(event.context, { auth: undefined });
    const controller = new AbortController();
    /**
     * Observes original IncomingMessage disconnects without cancelling shared verifier I/O.
     */
    const abort = (): void => controller.abort();
    event.node.req.once('aborted', abort);
    /**
     * Completed request bodies disconnect through the response rather than request abort events.
     */
    const close = (): void => {
      if (!event.node.res.writableFinished) {
        controller.abort();
      }
    };
    event.node.res.once('close', close);
    if (event.node.res.destroyed && !event.node.res.writableFinished) {
      controller.abort();
    }

    if (event.node.req.readableAborted) {
      controller.abort();
    }

    const decision = policyError
      ? { kind: 'reject' as const, error: policyError, http: policyError.toHttp() }
      : await guard.decide(
          {
            method: event.node.req.method ?? 'GET',
            url: event.node.req.url ?? '/',
            authorization: authorizationFromNodeRequest(event.node.req),
            header: (name: string): string | undefined => {
              const value = event.node.req.headers[name.toLowerCase()];
              return Array.isArray(value) ? value.join(', ') : value;
            },
          },
          controller.signal,
        );
    event.node.req.removeListener('aborted', abort);
    event.node.res.removeListener('close', close);
    if (decision.kind === 'reject') {
      if (event.node.res.destroyed) {
        throw createError({
          statusCode: decision.http.status,
          message: decision.error.message,
          cause: decision.error,
        });
      }

      if (onError) {
        try {
          const response = await onError(decision.error, event);
          if (response !== undefined) {
            if (!(response instanceof Response) || response.bodyUsed || response.body?.locked) {
              throw new Error('Unusable custom response');
            }

            await sendResponse(event, response);
            return;
          }
        } catch (cause) {
          guard.reportErrorHookFailure();
          if (event.node.res.headersSent) {
            throw cause;
          }
        }
      }

      if (event.node.res.destroyed) {
        throw createError({
          statusCode: decision.http.status,
          message: decision.error.message,
          cause: decision.error,
        });
      }

      await sendResponse(event, toResponse(decision.http));
      return;
    }

    Object.assign(event.context, { auth: decision.kind === 'skip' ? undefined : decision.auth });
    return;
  };
  return defineEventHandler(middleware);
}

/**
 * Reads bytes before response commitment so unreadable custom bodies can use the safe fallback.
 */
async function sendResponse(event: H3Event, response: Response): Promise<void> {
  const body = new Uint8Array(await response.arrayBuffer());
  if (!event.node.res.headersSent) {
    setResponseStatus(event, response.status);
    const cookies = response.headers.getSetCookie();
    setResponseHeaders(event, {
      ...Object.fromEntries(response.headers),
      ...(cookies.length > 0 ? { 'set-cookie': cookies } : {}),
    });
    await send(event, body);
  }
}
