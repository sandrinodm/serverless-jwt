import type { MiddlewareHandler } from 'astro';

import { jwtMiddleware } from '@serverless-jwt/astro';
import { sequence } from 'astro:middleware';

import { corsPreflight, corsResponse } from './capabilities.ts';
import { protect } from './protect.ts';

/**
 * Actual Astro composition preserves the original platform context and downstream function.
 */
export const onRequest: MiddlewareHandler = sequence(
  async (context, next): Promise<Response> =>
    corsPreflight(context.request) ?? corsResponse(context.request, await next()),
  jwtMiddleware({
    issuer: process.env.ISSUER ?? 'https://issuer.example',
    audience: 'https://resource.example',
    realm: process.env.AUTH_REALM ?? 'api',
    ...(process.env.JWKS_URI ? { jwksUri: process.env.JWKS_URI } : {}),
    protect,
  }),
  async (_context, next): Promise<Response> => next(),
);
