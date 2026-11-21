import type { RequestHandler } from '@sveltejs/kit';

import { requireAuth } from '@serverless-jwt/sveltekit';

import { capabilityResponse } from '../../../capabilities.ts';

/**
 * Protected data must always execute the hook at request time.
 */
export const prerender: boolean = false;

/**
 * Route-level checked access remains defense in depth for reroutes and predicate mistakes.
 */
export const GET: RequestHandler = ({ locals, request }) => {
  const auth = requireAuth(locals);
  return capabilityResponse(
    request,
    auth.claims.sub,
    Response.json({ sub: auth.claims.sub, scopes: auth.scopes }),
  );
};

/**
 * Forged preflights pass through the same mandatory authentication hook.
 */
export const OPTIONS: RequestHandler = GET;

/**
 * Protected mutations use the identical guarded fixture handler.
 */
export const POST: typeof GET = GET;
