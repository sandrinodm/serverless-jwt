# @serverless-jwt/react-router

Generated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.

## index.d.mts

```ts
import { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import { IntegrationOptions } from '@serverless-jwt/jwt-verifier/adapter';
import { MiddlewareFunction, RouterContext } from 'react-router';
/**
 * Application-owned context includes optional and deliberately skipped request states.
 */
export type AuthContext<TIdentity> = Readonly<RouterContext<Auth<TIdentity> | null | undefined>>;
/**
 * Creates an independent framework context whose value belongs only to the current request.
 */
export declare function createAuthContext<TIdentity = VerifiedClaims>(): AuthContext<TIdentity>;
/**
 * A required application context keeps independently typed integrations from sharing global state.
 */
export type ReactRouterOptions<TIdentity = VerifiedClaims> = IntegrationOptions<TIdentity> & {
  /**
   * Pass the same application-owned context to loaders and this middleware factory.
   */
  readonly context: AuthContext<TIdentity>;
  /**
   * Authentication failures can return a platform response before downstream middleware runs.
   */
  readonly onError?: (
    error: JwtVerifierError,
    args: Parameters<MiddlewareFunction>[0],
  ) => Response | undefined | Promise<Response | undefined>;
};
/**
 * Verifies once per request, stores auth on the native context, and preserves downstream results.
 */
export declare function jwtMiddleware<TIdentity = VerifiedClaims>(
  options: ReactRouterOptions<TIdentity>,
): MiddlewareFunction<Response>;
```
