# @serverless-jwt/express

Generated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.

## index.d.mts

```ts
import { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import { IntegrationOptions } from '@serverless-jwt/jwt-verifier/adapter';
import { Request, RequestHandler, Response } from 'express';
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
export declare function getAuth<TIdentity = unknown>(request: Request): Auth<TIdentity>;
/**
 * Creates one verifier and preserves duplicate credentials through the original Node request.
 */
export declare function jwt<TIdentity = VerifiedClaims>(
  options: ExpressOptions<TIdentity>,
): RequestHandler;
/**
 * Applies a route-local scope requirement to already authenticated request state.
 */
export declare function requireScopes(
  scopes: ReadonlyArray<string>,
  mode?: 'all' | 'any',
): RequestHandler;
```
