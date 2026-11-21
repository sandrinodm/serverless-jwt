import { withJwt } from '@serverless-jwt/vercel';

import { capabilityResponse, corsPreflight, corsResponse } from '../capabilities.ts';

/**
 * The actual named Web export retains a fixed third auth slot when the context is absent.
 */
const guarded: (request: Request, context?: unknown) => Promise<Response> = withJwt(
  {
    issuer: process.env.ISSUER ?? 'https://issuer.example',
    audience: 'https://resource.example',
    ...(process.env.JWKS_URI ? { jwksUri: process.env.JWKS_URI } : {}),
  },
  (request, context, auth): Response =>
    capabilityResponse(
      request,
      auth.claims.sub,
      Response.json({
        sub: auth.claims.sub,
        scopes: auth.scopes,
        context: context === undefined ? 'absent' : 'present',
      }),
    ),
);

/**
 * Application-owned CORS precedes the guarded handler without changing native context.
 */
export const GET: typeof guarded = async (request, context) =>
  corsPreflight(request) ?? corsResponse(request, await guarded(request, context));

/**
 * Explicit OPTIONS uses the same required guard as GET.
 */
export const OPTIONS: typeof GET = GET;

/**
 * Protected mutations use the identical guarded fixture handler.
 */
export const POST: typeof GET = GET;
