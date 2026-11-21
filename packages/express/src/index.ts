import type { Auth, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type { IntegrationOptions } from '@serverless-jwt/jwt-verifier/adapter';
import type { Request, RequestHandler, Response } from 'express';

import { JwtVerifierError, requireScopes as checkScopes } from '@serverless-jwt/jwt-verifier';
import { authorizationFromNodeRequest, createGuard } from '@serverless-jwt/jwt-verifier/adapter';

declare global {
  /**
   * Express globals describe all guarded, optional, skipped and public requests honestly.
   */
  namespace Express {
    /**
     * Authentication belongs to the original request only.
     */
    interface Request {
      /**
       * Unknown identity requires the application's checked accessor.
       */
      readonly auth?: Auth<unknown> | null | undefined;
    }
  }
}

/**
 * Express error hooks may finish a response; undefined selects the safe default before commitment.
 */
export type ExpressOptions<TIdentity = VerifiedClaims> = IntegrationOptions<TIdentity> & {
  /**
   * Awaited with the original request and response; custom responses should retain no-store.
   */
  readonly onError?: (
    error: JwtVerifierError,
    request: Request,
    response: Response,
  ) => void | Promise<void>;
};

/**
 * Checks that authentication actually ran before narrowing an application-owned identity.
 */
export function getAuth<TIdentity = unknown>(request: Request): Auth<TIdentity> {
  if (request.auth === null || request.auth === undefined) {
    throw new JwtVerifierError('auth_context_missing');
  }

  return request.auth as Auth<TIdentity>;
}

/**
 * Creates one verifier and preserves duplicate credentials through the original Node request.
 */
export function jwt<TIdentity = VerifiedClaims>(
  options: ExpressOptions<TIdentity>,
): RequestHandler {
  const guard = createGuard(options);
  const { onError } = options;
  return async (request, response, next): Promise<void> => {
    Object.assign(request, { auth: undefined });
    const controller = new AbortController();
    /**
     * Disconnect cancellation affects this invocation only, leaving shared key fetches available.
     */
    const abort = (): void => controller.abort();
    request.once('aborted', abort);
    /**
     * Completed request bodies disconnect through the response rather than request abort events.
     */
    const close = (): void => {
      if (!response.writableFinished) {
        controller.abort();
      }
    };
    response.once('close', close);
    if (response.destroyed && !response.writableFinished) {
      controller.abort();
    }

    if (request.readableAborted) {
      controller.abort();
    }

    const decision = await guard.decide(
      {
        method: request.method,
        url: request.originalUrl,
        authorization: authorizationFromNodeRequest(request),
        header: (name: string): string | undefined => request.get(name),
      },
      controller.signal,
    );
    request.removeListener('aborted', abort);
    response.removeListener('close', close);
    if (decision.kind === 'reject') {
      if (response.destroyed) {
        return;
      }

      if (onError) {
        try {
          const result: unknown = await onError(decision.error, request, response);
          if (result !== undefined) {
            throw new Error('Unusable custom response');
          }
        } catch (cause) {
          guard.reportErrorHookFailure();
          if (response.headersSent) {
            next(cause);
            return;
          }
        }
      }

      if (!response.headersSent && !response.destroyed) {
        response.status(decision.http.status).set(decision.http.headers).json(decision.http.body);
      }

      return;
    }

    Object.assign(request, { auth: decision.kind === 'skip' ? undefined : decision.auth });
    next();
  };
}

/**
 * Applies a route-local scope requirement to already authenticated request state.
 */
export function requireScopes(
  scopes: ReadonlyArray<string>,
  mode: 'all' | 'any' = 'all',
): RequestHandler {
  const required = Object.freeze([...scopes]);
  return (request, response, next): void => {
    try {
      checkScopes(getAuth(request), required, mode);
    } catch (cause) {
      if (!(cause instanceof JwtVerifierError)) {
        next(cause);
        return;
      }

      if (!response.headersSent && !response.destroyed) {
        const http = cause.toHttp();
        response.status(http.status).set(http.headers).json(http.body);
      }

      return;
    }

    next();
  };
}
