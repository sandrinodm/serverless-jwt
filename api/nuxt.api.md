# @serverless-jwt/nuxt

Generated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.

## index.d.mts

```ts
import { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import { IntegrationOptions } from '@serverless-jwt/jwt-verifier/adapter';
import { EventHandler, H3Event } from 'h3';
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
export declare function getAuth<TIdentity = unknown>(event: H3Event): Auth<TIdentity>;
/**
 * Captures immutable path policy and one verifier at module scope.
 */
export declare function jwtMiddleware<TIdentity = VerifiedClaims>(
  options: NuxtOptions<TIdentity>,
): EventHandler;
```
