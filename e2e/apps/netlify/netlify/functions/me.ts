import type { Context } from '@netlify/functions';

import { withJwt } from '@serverless-jwt/netlify';

import { capabilityResponse, corsPreflight, corsResponse } from '../../capabilities.ts';

/**
 * The actual Netlify platform owns Request and Context; authentication is explicit third-slot data.
 */
const handler: (request: Request, context: Context) => Promise<Response> = withJwt(
  {
    issuer: process.env.ISSUER ?? 'https://issuer.example',
    audience: 'https://resource.example',
    ...(process.env.JWKS_URI ? { jwksUri: process.env.JWKS_URI } : {}),
  },
  (request, context, auth) =>
    capabilityResponse(
      request,
      auth.claims.sub,
      Response.json({
        sub: auth.claims.sub,
        scopes: auth.scopes,
        request: request instanceof Request,
        context: typeof context.requestId === 'string',
      }),
    ),
);

/**
 * Application-owned CORS precedes the same native authentication wrapper.
 */
const composed: typeof handler = async (request, context) =>
  corsPreflight(request) ?? corsResponse(request, await handler(request, context));
export default composed;
