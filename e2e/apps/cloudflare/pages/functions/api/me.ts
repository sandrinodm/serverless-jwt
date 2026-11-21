import type { PagesFunction } from '@cloudflare/workers-types';
import type { JwtData } from '@serverless-jwt/cloudflare';

import { getAuth } from '@serverless-jwt/cloudflare';

import { capabilityResponse } from '../../../capabilities.ts';

/**
 * Reads only this Pages request's checked authentication state.
 */
export const onRequest: PagesFunction<unknown, string, JwtData> = (context) => {
  const auth = getAuth(context.data);
  return capabilityResponse(
    context.request,
    auth.claims.sub,
    Response.json({
      sub: auth.claims.sub,
      scopes: auth.scopes,
    }),
  ) as unknown as ReturnType<PagesFunction>;
};
