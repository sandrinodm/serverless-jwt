# @serverless-jwt/astro

Generated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.

## index.d.mts

```ts
import { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import { IntegrationOptions } from '@serverless-jwt/jwt-verifier/adapter';
import { APIContext, MiddlewareNext } from 'astro';
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
 * Returns checked request auth; application-owned identity types never leak into global
 * declarations. The installed middleware supplies a bare-challenge 401 for absent endpoint auth.
 */
export declare function requireAuth<TIdentity = unknown>(locals: App.Locals): Auth<TIdentity>;
/**
 * Constructs one verifier only after validating the mandatory immutable build/runtime policy
 * bridge.
 */
export declare function jwtMiddleware<TIdentity = VerifiedClaims>(
  options: JwtMiddlewareOptions<TIdentity>,
): (context: APIContext, next: MiddlewareNext) => Promise<Response>;
```
