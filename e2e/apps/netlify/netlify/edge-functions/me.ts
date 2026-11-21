import type { Context } from '@netlify/edge-functions';

import { withJwt } from '@serverless-jwt/netlify/edge';

import { capabilityResponse, corsPreflight, corsResponse } from '../../capabilities.ts';

/**
 * Reads the optional endpoint once without changing the platform environment.
 */
const jwksUri = Netlify.env.get('JWKS_URI');

/**
 * The actual Netlify platform owns Request and Context; authentication is explicit third-slot data.
 */
const handler: (request: Request, context: Context) => Promise<Response> = withJwt(
  {
    issuer: Netlify.env.get('ISSUER') ?? 'https://issuer.example',
    audience: 'https://resource.example',
    ...(jwksUri ? { jwksUri } : {}),
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
