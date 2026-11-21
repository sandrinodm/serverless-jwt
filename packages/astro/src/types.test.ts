import type { Auth } from '@serverless-jwt/jwt-verifier';
import type { APIContext, MiddlewareHandler, MiddlewareNext } from 'astro';

import { ConfigurationError, JwtVerifierError } from '@serverless-jwt/jwt-verifier';
import { expect, expectTypeOf, it } from 'vite-plus/test';

import { jwtMiddleware, requireAuth } from './index.ts';

it('uses real Astro middleware/context types and honest global locals with two checked identities', () => {
  const middleware = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: ['/api/**'],
    mapClaims: () => ({ first: 'one' }),
  });
  expectTypeOf(middleware).toExtend<MiddlewareHandler>();
  expectTypeOf(middleware).toEqualTypeOf<
    (context: APIContext, next: MiddlewareNext) => Promise<Response>
  >();
  expectTypeOf<App.Locals['auth']>().toEqualTypeOf<Auth<unknown> | null | undefined>();
  expectTypeOf<ReturnType<typeof requireAuth<{ first: string }>>>().toEqualTypeOf<
    Auth<{ first: string }>
  >();
  expectTypeOf<ReturnType<typeof requireAuth<{ second: number }>>>().toEqualTypeOf<
    Auth<{ second: number }>
  >();
  jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: ['/api/**'],
    mode: 'optional',
    skip: () => false,
  });
  expect(() => {
    // @ts-expect-error protection is mandatory
    jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api' });
  }).toThrow(ConfigurationError);
  expect(() => requireAuth({})).toThrow(JwtVerifierError);
});
