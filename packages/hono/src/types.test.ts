import type { Auth, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type { RequestInfoLike } from '@serverless-jwt/jwt-verifier/adapter';
import type { Context, MiddlewareHandler } from 'hono';

import { Hono } from 'hono';
import { expectTypeOf, it } from 'vite-plus/test';

import type { JwtEnv } from './index.ts';

import { jwt } from './index.ts';

it('preserves actual Hono middleware/context types and mapped app-owned identity', () => {
  const middleware = jwt({
    issuer: 'https://issuer.example',
    audience: 'api',
    mapClaims: (claims) => ({ subject: claims.sub }),
  });
  expectTypeOf(middleware).toEqualTypeOf<MiddlewareHandler<JwtEnv<{ subject: unknown }>>>();
  const app = new Hono<JwtEnv<{ readonly subject: unknown }>>();
  app.use('/api/*', middleware);
  app.get('/api/me', (context) => {
    expectTypeOf(context).toExtend<Context<JwtEnv<{ readonly subject: unknown }>>>();
    expectTypeOf(context.var.auth.identity).toEqualTypeOf<{ readonly subject: unknown }>();
    return context.json(context.var.auth.identity);
  });
  const other = new Hono<JwtEnv<{ readonly account: number }>>();
  other.use(
    jwt({ issuer: 'https://issuer.example', audience: 'api', mapClaims: () => ({ account: 1 }) }),
  );
  other.get('/api/me', (context) => {
    expectTypeOf(context.var.auth.identity).toEqualTypeOf<{ readonly account: number }>();
    return context.json(context.var.auth.identity);
  });
});

it('infers optional/skip states and makes rejection-hook auth absence explicit', () => {
  expectTypeOf(
    jwt({ issuer: 'https://issuer.example', audience: 'api', mode: 'optional' }),
  ).toEqualTypeOf<MiddlewareHandler<JwtEnv<VerifiedClaims, 'optional'>>>();
  const skipped = jwt({
    issuer: 'https://issuer.example',
    audience: 'api',
    skip: (request) => request.method === 'OPTIONS',
  });
  expectTypeOf(skipped).toEqualTypeOf<
    MiddlewareHandler<JwtEnv<VerifiedClaims, 'required', (request: RequestInfoLike) => boolean>>
  >();
  jwt({
    issuer: 'https://issuer.example',
    audience: 'api',
    onError: (_error, context) => {
      expectTypeOf(context.var.auth).toEqualTypeOf<Auth<VerifiedClaims> | undefined>();
      return undefined;
    },
  });
});
