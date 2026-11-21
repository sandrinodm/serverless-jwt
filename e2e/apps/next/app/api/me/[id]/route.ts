import type { NextRequest } from 'next/server.js';

import { withJwt } from '@serverless-jwt/next';

import { capabilityResponse, corsPreflight, corsResponse } from '../../../../capabilities.ts';
import { options } from '../../../../src/options.ts';

/**
 * The route verifies credentials independently of the early proxy rejection.
 */
const guarded: (
  request: NextRequest,
  context: { readonly params: Promise<{ readonly id: string }> },
) => Promise<Response> = withJwt(
  options,
  async (
    request: NextRequest,
    context: { readonly params: Promise<{ readonly id: string }> },
    auth,
  ): Promise<Response> => {
    const { id } = await context.params;
    return capabilityResponse(
      request,
      auth.claims.sub,
      Response.json({
        sub: auth.claims.sub,
        scopes: auth.scopes,
        id,
        spoofed: request.headers.get('x-auth-sub'),
      }),
    );
  },
);

/**
 * The application's CORS layer returns only recognized preflights before the guard.
 */
export const GET: typeof guarded = async (request, context) =>
  corsPreflight(request) ?? corsResponse(request, await guarded(request, context));

/**
 * Explicitly guards OPTIONS instead of Next's automatic unauthenticated method response.
 */
export const OPTIONS: typeof GET = GET;

/**
 * Protected mutations use the identical guarded fixture handler.
 */
export const POST: typeof GET = GET;
