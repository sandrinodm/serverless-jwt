import type { Auth, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type { Request as VercelRequestHeaders } from '@vercel/functions/headers';

import { expectTypeOf, it } from 'vite-plus/test';

import { withJwt } from './index.ts';

it('uses native Web Request satisfying the actual SDK request surface and keeps context optional', () => {
  expectTypeOf<Request>().toExtend<VercelRequestHeaders>();
  const route = withJwt(
    {
      issuer: 'https://issuer.example',
      audience: 'api',
      mapClaims: (claims) => ({ subject: claims.sub }),
    },
    (
      request,
      context: { readonly waitUntil: (promise: Promise<unknown>) => void } | undefined,
      auth,
    ) => {
      expectTypeOf(request).toEqualTypeOf<Request>();
      expectTypeOf(context).toEqualTypeOf<
        { readonly waitUntil: (promise: Promise<unknown>) => void } | undefined
      >();
      expectTypeOf(auth).toEqualTypeOf<Auth<{ subject: unknown }>>();
      return Response.json({});
    },
  );
  expectTypeOf(route).toEqualTypeOf<
    (
      request: Request,
      context?: { readonly waitUntil: (promise: Promise<unknown>) => void },
    ) => Promise<Response>
  >();
});

it('infers optional and skip auth without shifting callback argument positions', () => {
  withJwt(
    { issuer: 'https://issuer.example', audience: 'api', mode: 'optional' },
    (_r, _c, auth) => {
      expectTypeOf(auth).toEqualTypeOf<Auth<VerifiedClaims> | null>();
      return Response.json({});
    },
  );
  withJwt(
    {
      issuer: 'https://issuer.example',
      audience: 'api',
      skip: (request) => request.method === 'OPTIONS',
    },
    (_r, _c, auth) => {
      expectTypeOf(auth).toEqualTypeOf<Auth<VerifiedClaims> | undefined>();
      return Response.json({});
    },
  );
});
