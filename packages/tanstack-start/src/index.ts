import type { VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type { FunctionMiddlewareServerFn, RequestServerFn } from '@tanstack/start-client-core';

import { getRequest } from '@tanstack/start-server-core';

import type { Mode, Skip, TanStackAuth, TanStackOptions } from './policy.ts';

import { createPolicy } from './policy.ts';

export type { TanStackAuth, TanStackOptions } from './policy.ts';

/**
 * Server-only context is passed through next; it is never copied into client sendContext.
 */
export interface JwtContext<
  TIdentity,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> {
  /**
   * Verified identity, optional missing null, or deliberate skip undefined belongs to this request.
   */
  readonly auth: TanStackAuth<TIdentity, TMode, TSkip>;
}

/**
 * Native request callback retains the factory's mapped identity and enabled auth states.
 */
export type RequestJwtMiddleware<
  TIdentity,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = RequestServerFn<{}, undefined, JwtContext<TIdentity, TMode, TSkip>>;

/**
 * Native function callback sends auth only through server context, never client sendContext.
 */
export type FunctionJwtMiddleware<
  TIdentity,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = FunctionMiddlewareServerFn<
  {},
  unknown,
  undefined,
  undefined,
  JwtContext<TIdentity, TMode, TSkip>,
  undefined
>;

/**
 * Creates the native request-server callback for a first-party createMiddleware().server call.
 * Keeping the factory inside server(...) lets Start remove its complete policy from browser code.
 */
export function jwtMiddleware<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: TanStackOptions<TIdentity, TMode, Exclude<Skip, undefined>> & {
    readonly skip: Exclude<Skip, undefined>;
  },
): RequestJwtMiddleware<TIdentity, TMode, Exclude<Skip, undefined>>;

/**
 * Required-by-default callbacks preserve nonnullable mapped auth.
 */
export function jwtMiddleware<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: TanStackOptions<TIdentity, TMode>,
): RequestJwtMiddleware<TIdentity, TMode>;

/**
 * Pretyped broad request policies preserve all their declared auth states.
 */
export function jwtMiddleware<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: TanStackOptions<TIdentity, TMode, Skip>,
): RequestJwtMiddleware<TIdentity, TMode, Skip>;

/**
 * The first-party server(...) call removes this complete factory/policy from browser code.
 */
export function jwtMiddleware<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: TanStackOptions<TIdentity, TMode, Skip>,
): RequestJwtMiddleware<TIdentity, TMode> | RequestJwtMiddleware<TIdentity, TMode, Skip> {
  const policy = createPolicy(options);
  return async ({ request, next }) => {
    const result = await policy(request);
    if ('response' in result) {
      return result.response;
    }

    return next({ context: { auth: result.auth } });
  };
}

/**
 * Creates a native function-server callback using Start's actual current-request accessor. Function
 * middleware rejects by throwing Response, as required by its real next-result contract.
 */
export function jwtFunctionMiddleware<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: TanStackOptions<TIdentity, TMode, Exclude<Skip, undefined>> & {
    readonly skip: Exclude<Skip, undefined>;
  },
): FunctionJwtMiddleware<TIdentity, TMode, Exclude<Skip, undefined>>;

/**
 * Required-by-default function callbacks preserve nonnullable mapped auth.
 */
export function jwtFunctionMiddleware<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: TanStackOptions<TIdentity, TMode>,
): FunctionJwtMiddleware<TIdentity, TMode>;

/**
 * Pretyped broad function policies preserve all their declared auth states.
 */
export function jwtFunctionMiddleware<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: TanStackOptions<TIdentity, TMode, Skip>,
): FunctionJwtMiddleware<TIdentity, TMode, Skip>;

/**
 * Function callbacks use Start's real current-request accessor and throw rejection responses.
 */
export function jwtFunctionMiddleware<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: TanStackOptions<TIdentity, TMode, Skip>,
): FunctionJwtMiddleware<TIdentity, TMode> | FunctionJwtMiddleware<TIdentity, TMode, Skip> {
  const policy = createPolicy(options);
  return async ({ next }) => {
    const result = await policy(getRequest());
    if ('response' in result) {
      throw result.response;
    }

    return next({ context: { auth: result.auth } });
  };
}
