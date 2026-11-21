import type { Handle } from '@sveltejs/kit/hooks';

import { AUTH_REALM, ISSUER, JWKS_URI } from '$app/env/private';
import { jwtHandle } from '@serverless-jwt/sveltekit';
import { sequence } from '@sveltejs/kit/hooks';

import { corsPreflight, corsResponse } from './capabilities.ts';
import { protect } from './protect.ts';

/**
 * Composes the actual runtime hook with ordinary downstream framework hooks.
 */
export const handle: Handle = sequence(
  async ({ event, resolve }): Promise<Response> =>
    corsPreflight(event.request) ?? corsResponse(event.request, await resolve(event)),
  jwtHandle({
    issuer: ISSUER,
    audience: 'https://resource.example',
    realm: AUTH_REALM,
    ...(JWKS_URI ? { jwksUri: JWKS_URI } : {}),
    protect,
  }),
  async ({ event, resolve }): Promise<Response> => resolve(event),
);
