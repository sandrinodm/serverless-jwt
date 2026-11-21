import type { APIRoute } from 'astro';

import { requireAuth } from '@serverless-jwt/astro';

import { capabilityResponse } from '../../capabilities.ts';

/**
 * Protected endpoints always execute middleware at request time.
 */
export const prerender = false as const;

/**
 * Checked access remains defense in depth if routing policy is misconfigured.
 */
export const GET: APIRoute = ({ locals, request }) => {
  const auth = requireAuth(locals);
  return capabilityResponse(
    request,
    auth.claims.sub,
    Response.json({ sub: auth.claims.sub, scopes: auth.scopes }),
  );
};

/**
 * Actual forged preflights reach the same required authentication policy.
 */
export const OPTIONS: APIRoute = GET;

/**
 * Protected mutations use the identical guarded fixture handler.
 */
export const POST: typeof GET = GET;
