import type { JwtVerifierOptions } from '@serverless-jwt/jwt-verifier';

/**
 * Server runtime configuration is evaluated independently in proxy and route bundles.
 */
export const options: JwtVerifierOptions = {
  /**
   * Runtime issuer override uses the verified local HTTPS fixture in contracts.
   */
  issuer: process.env.ISSUER ?? 'https://issuer.example',

  /**
   * This resource audience never identifies a browser OIDC client.
   */
  audience: 'https://resource.example',
  ...(process.env.JWKS_URI ? { jwksUri: process.env.JWKS_URI } : {}),
};
