import type { H3Event } from 'h3';

import { jwtMiddleware } from '@serverless-jwt/nuxt';
import { defineEventHandler, getHeader, getRequestURL, setHeader } from 'h3';

import { corsPreflight } from '../../capabilities.ts';

/**
 * The original native guard is captured once and receives the unchanged event after app CORS.
 */
const guarded = jwtMiddleware({
  issuer: process.env.ISSUER ?? 'https://issuer.example',
  audience: 'https://resource.example',
  protect:
    process.env.PROTECT_PREDICATE === '1'
      ? (event: H3Event): boolean => event.path.split('?', 1)[0] === '/protected'
      : ['/protected'],
  ...(process.env.JWKS_URI ? { jwksUri: process.env.JWKS_URI } : {}),
});

/**
 * Native event middleware retains Nuxt's own event and response while handling CORS first.
 */
export default defineEventHandler(async (event) => {
  const request = {
    url: getRequestURL(event).href,
    method: event.method,
    headers: { get: (name: string): string | null => getHeader(event, name) ?? null },
  };
  const preflight = corsPreflight(request);
  if (preflight) {
    return preflight;
  }

  if (
    new URL(request.url).searchParams.get('e2e_cors') === '1' &&
    request.headers.get('origin') === 'https://cors.example'
  ) {
    setHeader(event, 'access-control-allow-origin', 'https://cors.example');
  }

  return guarded(event);
});
