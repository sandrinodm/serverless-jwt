import type { AuthContext } from '@serverless-jwt/react-router';
import type { MiddlewareFunction } from 'react-router';

import { createAuthContext, jwtMiddleware } from '@serverless-jwt/react-router';

/**
 * This application owns its request identity key rather than merging a global auth declaration.
 */
export const authContext: AuthContext<{ readonly subject: string }> = createAuthContext();

/**
 * Real framework resource routes attach middleware directly, including encoded route aliases.
 */
export const authentication: MiddlewareFunction<Response> = jwtMiddleware({
  issuer: process.env.ISSUER ?? 'https://issuer.example',
  audience: 'https://resource.example',
  ...(process.env.JWKS_URI ? { jwksUri: process.env.JWKS_URI } : {}),
  context: authContext,
  mapClaims: (claims) => ({ subject: String(claims.sub) }),
});
