import type { APIEvent } from '@solidjs/start/server';

import { getAuth } from '@serverless-jwt/nuxt/h3-v2';

import { capabilityResponse } from '../../capabilities.ts';

/**
 * Native SolidStart method exports read identity only from their original native event.
 */
function protectedResponse(event: APIEvent): Response {
  const auth = getAuth(event.nativeEvent);
  return capabilityResponse(
    event.request,
    auth.claims.sub,
    Response.json({ sub: auth.claims.sub, scopes: auth.scopes }),
  );
}

export { protectedResponse as GET, protectedResponse as POST, protectedResponse as OPTIONS };
