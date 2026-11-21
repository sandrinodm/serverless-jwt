# @serverless-jwt/fastify

Generated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.

## index.d.mts

```ts
import { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import { IntegrationOptions } from '@serverless-jwt/jwt-verifier/adapter';
import {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  onRequestAsyncHookHandler,
} from 'fastify';
declare module 'fastify' {
  /**
   * The plugin exposes an opt-in hook on its registration scope.
   */
  interface FastifyInstance {
    /**
     * Authenticates only routes that explicitly install this hook unless global is true.
     */
    readonly authenticate: onRequestAsyncHookHandler;
  }
  /**
   * Global augmentation must represent every possible factory and route state.
   */
  interface FastifyRequest {
    /**
     * Per-request authentication, never shared between requests or plugin scopes.
     */
    readonly auth: Auth<unknown> | null | undefined;
  }
}
/**
 * Fastify hooks belong to the parent registration scope because fastify-plugin breaks
 * encapsulation.
 */
export type FastifyOptions<TIdentity = VerifiedClaims> = IntegrationOptions<TIdentity> & {
  /**
   * Protects every route in the registration scope; use an encapsulated child for a prefix.
   */
  readonly global?: boolean;
  /**
   * May finish the reply; undefined selects the default before commitment.
   */
  readonly onError?: (
    error: JwtVerifierError,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => void | Promise<void>;
};
/**
 * Checks request state before narrowing the application's identity.
 */
export declare function getAuth<TIdentity = unknown>(request: FastifyRequest): Auth<TIdentity>;
/**
 * Fastify's official plugin wrapper exposes decorators without accidentally encapsulating them.
 */
export declare const serverlessJwt: FastifyPluginAsync<FastifyOptions<unknown>>;
```
