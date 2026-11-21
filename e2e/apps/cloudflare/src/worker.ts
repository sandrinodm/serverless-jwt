import type {
  ExecutionContext,
  ExportedHandler,
  ExportedHandlerFetchHandler,
  Response as WorkerResponse,
} from '@cloudflare/workers-types';

import { withJwt } from '@serverless-jwt/cloudflare';

import { capabilityResponse, corsPreflight, corsResponse } from '../capabilities.ts';

/**
 * Deployment configuration arrives through original Workers bindings.
 */
export interface Env {
  /**
   * Exact issuer URL, supplied by the real HTTPS contract fixture locally.
   */
  readonly ISSUER: string;

  /**
   * Optional direct endpoint used to exercise hostile key outages.
   */
  readonly JWKS_URI?: string;
}

/**
 * One guarded module handler reuses its own bounded verifier policy.
 */
const protectedFetch = withJwt(
  (env: Env) => ({
    issuer: env.ISSUER,
    audience: 'https://resource.example',
    ...(env.JWKS_URI ? { jwksUri: env.JWKS_URI } : {}),
  }),
  async (request, _env, _ctx, auth) =>
    capabilityResponse(
      request,
      auth.claims.sub,
      Response.json({
        sub: auth.claims.sub,
        scopes: auth.scopes,
      }),
    ),
);

/**
 * Actual Workers export retains explicit declaration boundaries in isolated peer consumers.
 */
const worker: ExportedHandler<Env> = {
  /**
   * Serves readiness outside the protected API and preserves the original platform arguments.
   */
  fetch: async (
    request: Parameters<ExportedHandlerFetchHandler<Env>>[0],
    env: Env,
    ctx: ExecutionContext,
  ): Promise<WorkerResponse> => {
    if (new URL(request.url).pathname === '/ready') {
      return new Response('ready') as unknown as WorkerResponse;
    }

    const preflight = corsPreflight(request);
    if (preflight) {
      return preflight as unknown as WorkerResponse;
    }

    return corsResponse(
      request,
      (await protectedFetch(request, env, ctx)) as unknown as Response,
    ) as unknown as WorkerResponse;
  },
};

export default worker;
