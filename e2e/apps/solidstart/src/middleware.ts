import { jwtMiddleware } from '@serverless-jwt/nuxt/h3-v2';
import { createMiddleware } from '@solidjs/start/middleware';

import { corsPreflight, corsResponse } from '../capabilities.ts';

/**
 * A module-owned guard receives SolidStart's unchanged native H3 event.
 */
const guarded = jwtMiddleware({
  issuer: process.env.ISSUER ?? 'https://issuer.example',
  audience: 'https://resource.example',
  protect: ['/protected'],
  ...(process.env.JWKS_URI ? { jwksUri: process.env.JWKS_URI } : {}),
});

export default createMiddleware([
  async (event, next) => {
    const preflight = corsPreflight(event.req);
    if (preflight) {
      return preflight;
    }

    if (
      new URL(event.req.url).searchParams.get('e2e_cors') === '1' &&
      event.req.headers.get('origin') === 'https://cors.example'
    ) {
      event.res.headers.set('access-control-allow-origin', 'https://cors.example');
    }

    const rejected = await guarded(event);
    if (rejected !== undefined) {
      return corsResponse(event.req, rejected);
    }

    return next();
  },
]);
