import type { PagesFunction } from '@cloudflare/workers-types';

import { jwtMiddleware } from '@serverless-jwt/cloudflare';

import type { Env } from '../../src/worker.ts';

import { corsPreflight, corsResponse } from '../../capabilities.ts';

/**
 * One guarded Pages middleware reuses its policy for every request after the readiness route.
 */
const guarded = jwtMiddleware((env: Env) => ({
  issuer: env.ISSUER,
  audience: 'https://resource.example',
  ...(env.JWKS_URI ? { jwksUri: env.JWKS_URI } : {}),
}));

/**
 * Readiness is explicitly outside the protected API and never carries authentication state.
 */
export const onRequest: PagesFunction<Env> = async (context) => {
  if (new URL(context.request.url).pathname === '/ready') {
    return new Response('ready') as unknown as ReturnType<PagesFunction>;
  }

  const preflight = corsPreflight(context.request);
  if (preflight) {
    return preflight as unknown as ReturnType<PagesFunction>;
  }

  return corsResponse(
    context.request,
    (await guarded(context)) as unknown as Response,
  ) as unknown as ReturnType<PagesFunction>;
};
