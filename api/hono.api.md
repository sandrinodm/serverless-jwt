# @serverless-jwt/hono

Generated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.

## index.d.mts

```ts
import { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import { IntegrationOptions, RequestInfoLike } from '@serverless-jwt/jwt-verifier/adapter';
import { Context, MiddlewareHandler } from 'hono';
/**
 * Authentication mode controls missing-credential state.
 */
type Mode = 'required' | 'optional';
/**
 * An explicit synchronous skip permits unauthenticated access.
 */
type Skip = ((request: RequestInfoLike) => boolean) | undefined;
/**
 * Hono's app-owned environment preserves the factory's identity, mode and skip states.
 */
export interface JwtEnv<
  TIdentity = VerifiedClaims,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> {
  /**
   * Variables belong only to the current Hono request context.
   */
  readonly Variables: {
    /**
     * Required auth, optional missing null, or explicit skip undefined.
     */
    readonly auth:
      | Auth<TIdentity>
      | (TMode extends 'optional' ? null : never)
      | (TSkip extends undefined ? never : undefined);
  };
}
/**
 * Hono policy with an awaited platform-owned rejection hook.
 */
export type HonoOptions<
  TIdentity = VerifiedClaims,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = IntegrationOptions<TIdentity> & {
  /**
   * Required by default; invalid tokens always reject.
   */
  readonly mode?: TMode;
  /**
   * Deliberately permits unauthenticated access for matching request views.
   */
  readonly skip?: TSkip;
  /**
   * Undefined uses the default; custom responses should retain no-store.
   */
  readonly onError?: (
    error: JwtVerifierError,
    context: Context<JwtEnv<TIdentity, TMode, Skip>>,
  ) => Response | undefined | Promise<Response | undefined>;
};
/**
 * Explicit skip middleware advertises undefined in its request-owned auth variable.
 */
export declare function jwt<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: HonoOptions<TIdentity, TMode, (request: RequestInfoLike) => boolean> & {
    readonly skip: (request: RequestInfoLike) => boolean;
  },
): MiddlewareHandler<JwtEnv<TIdentity, TMode, (request: RequestInfoLike) => boolean>>;
/**
 * Required-by-default middleware preserves nonnullable mapped identity.
 */
export declare function jwt<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: HonoOptions<TIdentity, TMode>,
): MiddlewareHandler<JwtEnv<TIdentity, TMode>>;
/**
 * Pretyped broad policies preserve every enabled auth state.
 */
export declare function jwt<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: HonoOptions<TIdentity, TMode, Skip>,
): MiddlewareHandler<JwtEnv<TIdentity, TMode, Skip>>;
export {};
```
