import type { H3Event } from 'h3';

import { jwtMiddleware, getAuth } from '@serverless-jwt/nuxt/h3-v2';
import { H3, toNodeHandler } from 'h3';
import { createServer } from 'node:http';

import { capabilityResponse, corsPreflight, corsResponse } from '../capabilities.ts';

/**
 * H3 v2 owns Web Requests and per-request context under a real Node listener.
 */
const app = new H3({ silent: true });
app.use(async (event, next) => {
  const preflight = corsPreflight(event.req);
  if (preflight) {
    return preflight;
  }

  if (
    event.url.searchParams.get('e2e_cors') === '1' &&
    event.req.headers.get('origin') === 'https://cors.example'
  ) {
    event.res.headers.set('access-control-allow-origin', 'https://cors.example');
  }

  const result = await next();
  return result instanceof Response ? corsResponse(event.req, result) : result;
});
app.use(
  jwtMiddleware({
    issuer: process.env.ISSUER ?? 'https://issuer.example',
    audience: 'https://resource.example',
    protect:
      process.env.PROTECT_PREDICATE === '1'
        ? (event: H3Event): boolean => event.url.pathname === '/protected'
        : ['/protected'],
    ...(process.env.JWKS_URI ? { jwksUri: process.env.JWKS_URI } : {}),
  }),
);
app.get('/ready', () => 'ready');
app.all('/protected', (event) =>
  capabilityResponse(
    event.req,
    getAuth(event).claims.sub,
    Response.json({
      sub: getAuth(event).claims.sub,
      scopes: getAuth(event).scopes,
    }),
  ),
);
createServer(toNodeHandler(app)).listen(Number(process.env.PORT), '127.0.0.1');
