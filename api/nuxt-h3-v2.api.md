# @serverless-jwt/nuxt/h3-v2

Generated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.

## h3-v2.d.mts

```ts
import { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import { IntegrationOptions } from '@serverless-jwt/jwt-verifier/adapter';
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
export declare function getAuth<TIdentity = unknown>(event: WebEvent): Auth<TIdentity>;
/**
 * Captures immutable path policy and one verifier at module scope.
 */
export declare function jwtMiddleware<
  TIdentity = VerifiedClaims,
  TEvent extends WebEvent = WebEvent,
>(options: NuxtOptions<TIdentity, TEvent>): (event: TEvent) => Promise<Response | undefined>;
```
