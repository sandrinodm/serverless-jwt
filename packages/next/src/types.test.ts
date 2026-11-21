import type { Auth, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type { SatoriOptions as SatoriBridge } from 'next/dist/compiled/@vercel/og/satori';
import type { SatoriOptions as SatoriOriginal } from 'next/dist/compiled/@vercel/og/satori/index.js';
import type { AppRouteHandlerFn } from 'next/dist/server/route-modules/app-route/module.js';
import type { NextProxy, NextRequest } from 'next/server.js';
import type * as SharpCJS from 'sharp' with { 'resolution-mode': 'require' };
import type { SharpConstructor as SharpESM } from 'sharp';

import { expectTypeOf, it } from 'vite-plus/test';

import { createProxyGuard, withJwt } from './index.ts';

it('assigns to real Next route/proxy types and preserves promised dynamic context', () => {
  const route = withJwt(
    {
      issuer: 'https://issuer.example',
      audience: 'api',
      mapClaims: (claims) => ({ subject: claims.sub }),
    },
    (request, context: Parameters<AppRouteHandlerFn>[1], auth) => {
      expectTypeOf(request).toEqualTypeOf<NextRequest>();
      expectTypeOf(context).toEqualTypeOf<Parameters<AppRouteHandlerFn>[1]>();
      expectTypeOf(auth).toEqualTypeOf<Auth<{ subject: unknown }>>();
      return Response.json({});
    },
  );
  expectTypeOf(route).toExtend<AppRouteHandlerFn>();
  expectTypeOf(
    createProxyGuard({ issuer: 'https://issuer.example', audience: 'api' }),
  ).toExtend<NextProxy>();
  withJwt(
    { issuer: 'https://issuer.example', audience: 'api' },
    (_request, context: { readonly params: Promise<{ readonly id: string }> }, auth) => {
      expectTypeOf(context.params).toEqualTypeOf<Promise<{ readonly id: string }>>();
      expectTypeOf(auth).toEqualTypeOf<Auth<VerifiedClaims>>();
      return Response.json({});
    },
  );
});

it('infers optional and synchronous skip states with contextual request typing', () => {
  withJwt(
    { issuer: 'https://issuer.example', audience: 'api', mode: 'optional' },
    (_request, _context, auth) => {
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
    (_request, _context, auth) => {
      expectTypeOf(auth).toEqualTypeOf<Auth<VerifiedClaims> | undefined>();
      return Response.json({});
    },
  );
  withJwt(
    { issuer: 'https://issuer.example', audience: 'api', mode: 'optional', skip: () => false },
    (_request, _context, auth) => {
      expectTypeOf(auth).toEqualTypeOf<Auth<VerifiedClaims> | null | undefined>();
      return Response.json({});
    },
  );
});

/**
 * Compile-only negatives fail if declaration corrections widen real framework types.
 */
function negativeDeclarations(sharp: SharpCJS.SharpConstructor): void {
  // @ts-expect-error The actual Sharp constructor rejects a boolean input.
  void sharp(true);
  // @ts-expect-error The actual Sharp constructor has no invented property.
  void sharp.notAnActualSharpMember;
  const route = withJwt({ issuer: 'https://issuer.example', audience: 'api' }, () =>
    Response.json({}),
  );
  // @ts-expect-error A plain Request lacks the real NextRequest members.
  void route(new Request('https://resource.example'), { params: Promise.resolve({}) });
}

it('preserves exact real Satori and Sharp types through declaration-only correction links', () => {
  expectTypeOf<SharpCJS.SharpConstructor>().toEqualTypeOf<SharpESM>();
  expectTypeOf<SharpCJS.SharpConstructor>().not.toBeAny();
  expectTypeOf<SatoriBridge>().toEqualTypeOf<SatoriOriginal>();
  expectTypeOf<SatoriBridge>().not.toBeAny();
  void negativeDeclarations;
});
