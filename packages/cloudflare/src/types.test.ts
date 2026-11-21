import type {
  ExportedHandler,
  ExportedHandlerFetchHandler,
  PagesFunction,
} from '@cloudflare/workers-types';
import type { Auth, VerifiedClaims } from '@serverless-jwt/jwt-verifier';

import { expectTypeOf, it } from 'vite-plus/test';

import type { getAuth } from './index.ts';

import { jwtMiddleware, withJwt } from './index.ts';

/**
 * Real framework declarations define assignability; identity never leaks across factories.
 */
interface Env {
  readonly tenant: string;
}

it('preserves Workers arguments, mapped identity, mode and explicit skip inference', () => {
  const fetch = withJwt(
    {
      issuer: 'https://issuer.example',
      audience: 'api',
      mapClaims: (claims) => ({ user: claims.sub }),
    },
    (request, env: Env, context, auth) => {
      expectTypeOf(request).toEqualTypeOf<Parameters<ExportedHandlerFetchHandler>[0]>();
      expectTypeOf(env).toEqualTypeOf<Env>();
      expectTypeOf(context).toEqualTypeOf<Parameters<ExportedHandlerFetchHandler>[2]>();
      expectTypeOf(auth).toEqualTypeOf<Auth<{ user: unknown }>>();
      return Response.json(auth.identity);
    },
  );
  expectTypeOf(fetch).toExtend<ExportedHandlerFetchHandler<Env>>();
  const exported: ExportedHandler<Env> = { fetch };
  expectTypeOf(exported).toExtend<ExportedHandler<Env>>();

  withJwt(
    { issuer: 'https://issuer.example', audience: 'api', mode: 'optional' },
    (_r, _e, _c, auth) => {
      expectTypeOf(auth).toEqualTypeOf<Auth<VerifiedClaims> | null>();
      return Response.json({});
    },
  );
  withJwt(
    { issuer: 'https://issuer.example', audience: 'api', skip: () => true },
    (_r, _e, _c, auth) => {
      expectTypeOf(auth).toEqualTypeOf<Auth<VerifiedClaims> | undefined>();
      return Response.json({});
    },
  );
  withJwt(
    { issuer: 'https://issuer.example', audience: 'api', mode: 'optional', skip: () => false },
    (_r, _e, _c, auth) => {
      expectTypeOf(auth).toEqualTypeOf<Auth<VerifiedClaims> | null | undefined>();
      return Response.json({});
    },
  );
});

it('uses actual Pages context and checked accessors for independent app identity types', () => {
  const pages = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    onError: (_error, context) => {
      expectTypeOf(context.request).toEqualTypeOf<Parameters<PagesFunction>[0]['request']>();
      return undefined;
    },
  });
  expectTypeOf(pages).toExtend<PagesFunction>();
  expectTypeOf<ReturnType<typeof getAuth<{ readonly user: string }>>['identity']>().toEqualTypeOf<{
    readonly user: string;
  }>();
  expectTypeOf<
    ReturnType<typeof getAuth<{ readonly account: number }>>['identity']
  >().toEqualTypeOf<{ readonly account: number }>();
});
