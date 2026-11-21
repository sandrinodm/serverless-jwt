/// <reference lib="es2024.promise" preserve="true" />
/// <reference path="./next-compat.d.ts" preserve="true" />
/// <reference path="./sharp-compat.d.cts" preserve="true" />

import type { Auth, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type { JwtVerifierError } from '@serverless-jwt/jwt-verifier';
import type { IntegrationOptions, RequestInfoLike } from '@serverless-jwt/jwt-verifier/adapter';
import type { NextApiRequest, NextApiResponse } from 'next';

import { authorizationFromNodeRequest, createGuard } from '@serverless-jwt/jwt-verifier/adapter';

/**
 * Missing-credential state follows the factory's mode.
 */
type Mode = 'required' | 'optional';
/**
 * Undefined authentication is possible only with an explicit skip.
 */
type Skip = ((request: RequestInfoLike) => boolean) | undefined;
/**
 * Pages handlers receive only the authentication states enabled by their policy.
 */
export type PagesAuth<TIdentity, TMode extends Mode = 'required', TSkip extends Skip = undefined> =
  | Auth<TIdentity>
  | (TMode extends 'optional' ? null : never)
  | (TSkip extends undefined ? never : undefined);
/**
 * Pages rejection hooks receive the original mutable platform response.
 */
export type PagesOptions<
  TIdentity = VerifiedClaims,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = IntegrationOptions<TIdentity> & {
  /**
   * Required by default; optional missing credentials produce null.
   */
  readonly mode?: TMode;
  /**
   * Explicitly permits unauthenticated access for matching request views.
   */
  readonly skip?: TSkip;
  /**
   * May finish the response; undefined selects the default before commitment.
   */
  readonly onError?: (
    error: JwtVerifierError,
    request: NextApiRequest,
    response: NextApiResponse,
  ) => void | Promise<void>;
};
/**
 * Explicit skip handlers receive undefined for deliberately unguarded requests.
 */
export function withJwtPages<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: PagesOptions<TIdentity, TMode, (request: RequestInfoLike) => boolean> & {
    readonly skip: (request: RequestInfoLike) => boolean;
  },
  handler: (
    request: NextApiRequest,
    response: NextApiResponse,
    auth: PagesAuth<TIdentity, TMode, (request: RequestInfoLike) => boolean>,
  ) => void | Promise<void>,
): (event: NextApiRequest, context: NextApiResponse) => Promise<void>;

/**
 * Required handlers retain nonnullable Auth unless optional mode is selected.
 */
export function withJwtPages<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: PagesOptions<TIdentity, TMode, undefined>,
  handler: (
    request: NextApiRequest,
    response: NextApiResponse,
    auth: PagesAuth<TIdentity, TMode, undefined>,
  ) => void | Promise<void>,
): (event: NextApiRequest, context: NextApiResponse) => Promise<void>;

/**
 * Broad pretyped policies preserve all authentication states enabled by the caller.
 */
export function withJwtPages<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: PagesOptions<TIdentity, TMode, Skip>,
  handler: (
    request: NextApiRequest,
    response: NextApiResponse,
    auth: PagesAuth<TIdentity, TMode, Skip>,
  ) => void | Promise<void>,
): (event: NextApiRequest, context: NextApiResponse) => Promise<void>;

/**
 * Guards a Pages API handler without modifying its request or catching application errors.
 */
export function withJwtPages<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: PagesOptions<TIdentity, TMode, Skip>,
  handler:
    | ((
        request: NextApiRequest,
        response: NextApiResponse,
        auth: PagesAuth<TIdentity, TMode, undefined>,
      ) => void | Promise<void>)
    | ((
        request: NextApiRequest,
        response: NextApiResponse,
        auth: PagesAuth<TIdentity, TMode, Skip>,
      ) => void | Promise<void>),
): (request: NextApiRequest, response: NextApiResponse) => Promise<void> {
  const guard = createGuard<TIdentity, TMode>(options);
  const { onError } = options;
  return async (request, response): Promise<void> => {
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
        method: request.method ?? 'GET',
        url: request.url ?? '/',
        authorization: authorizationFromNodeRequest(request),
        header: (name: string): string | undefined => {
          const value = request.headers[name.toLowerCase()];
          return Array.isArray(value) ? value.join(', ') : value;
        },
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
            throw cause;
          }
        }
      }

      if (!response.headersSent && !response.destroyed) {
        response.status(decision.http.status);
        for (const [name, value] of Object.entries(decision.http.headers)) {
          response.setHeader(name, value);
        }

        response.json(decision.http.body);
      }

      return;
    }

    await (
      handler as (
        request: NextApiRequest,
        response: NextApiResponse,
        auth: PagesAuth<TIdentity, TMode, Skip>,
      ) => void | Promise<void>
    )(
      request,
      response,
      (decision.kind === 'skip' ? undefined : decision.auth) as PagesAuth<TIdentity, TMode, Skip>,
    );
  };
}
