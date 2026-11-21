# @serverless-jwt/netlify/edge

Generated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.

## edge.d.mts

```ts
import { Context } from '@netlify/edge-functions';
import { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import { IntegrationOptions, RequestInfoLike } from '@serverless-jwt/jwt-verifier/adapter';
/**
 * Missing-credential policy controls handler auth inference.
 */
type Mode = 'required' | 'optional';
/**
 * Only an explicit synchronous skip permits unauthenticated access.
 */
type Skip = ((request: RequestInfoLike) => boolean) | undefined;
/**
 * Authentication states enabled by this factory's mode and skip policy.
 */
export type NetlifyAuth<
  TIdentity,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> =
  | Auth<TIdentity>
  | (TMode extends 'optional' ? null : never)
  | (TSkip extends undefined ? never : undefined);
/**
 * Web-function policy preserves a platform-owned platform second context argument.
 */
export type NetlifyOptions<
  TIdentity = VerifiedClaims,
  TContext extends Context = Context,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = IntegrationOptions<TIdentity> & {
  /**
   * Required by default; invalid tokens reject in either mode.
   */
  readonly mode?: TMode;
  /**
   * Deliberately permits unauthenticated requests, supplying undefined auth.
   */
  readonly skip?: TSkip;
  /**
   * Undefined selects the default; custom responses should retain no-store.
   */
  readonly onError?: (
    error: JwtVerifierError,
    request: Request,
    context: TContext,
  ) => Response | undefined | Promise<Response | undefined>;
};
/**
 * Auth always occupies the third callback slot, without modifying the platform context.
 */
export type JwtNetlifyHandler<
  TIdentity,
  TContext extends Context = Context,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = (
  request: Request,
  context: TContext,
  auth: NetlifyAuth<TIdentity, TMode, TSkip>,
) => Response | Promise<Response>;
/**
 * Explicit-skip handlers admit undefined auth.
 */
export declare function withJwt<
  TIdentity = VerifiedClaims,
  TContext extends Context = Context,
  TMode extends Mode = 'required',
>(
  options: NetlifyOptions<TIdentity, TContext, TMode, (request: RequestInfoLike) => boolean> & {
    readonly skip: (request: RequestInfoLike) => boolean;
  },
  handler: JwtNetlifyHandler<TIdentity, TContext, TMode, (request: RequestInfoLike) => boolean>,
): (request: Request, context: TContext) => Promise<Response>;
/**
 * Required-by-default handlers preserve nonnullable mapped identity.
 */
export declare function withJwt<
  TIdentity = VerifiedClaims,
  TContext extends Context = Context,
  TMode extends Mode = 'required',
>(
  options: NetlifyOptions<TIdentity, TContext, TMode>,
  handler: JwtNetlifyHandler<TIdentity, TContext, TMode>,
): (request: Request, context: TContext) => Promise<Response>;
/**
 * Pretyped policies keep all declared optional and skip states.
 */
export declare function withJwt<
  TIdentity = VerifiedClaims,
  TContext extends Context = Context,
  TMode extends Mode = Mode,
>(
  options: NetlifyOptions<TIdentity, TContext, TMode, Skip>,
  handler: JwtNetlifyHandler<TIdentity, TContext, TMode, Skip>,
): (request: Request, context: TContext) => Promise<Response>;
export {};
```
