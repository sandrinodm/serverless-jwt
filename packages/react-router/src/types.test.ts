import type { Auth } from '@serverless-jwt/jwt-verifier';
import type { MiddlewareFunction } from 'react-router';

import { ConfigurationError } from '@serverless-jwt/jwt-verifier';
import { RouterContextProvider } from 'react-router';
import { expect, expectTypeOf, it } from 'vite-plus/test';

import { createAuthContext, jwtMiddleware } from './index.ts';

it('preserves independent app-owned identity contexts and honest optional/skip states', () => {
  const first = createAuthContext<{ subject: string }>();
  const second = createAuthContext<{ account: number }>();
  const provider = new RouterContextProvider();
  provider.set(first, undefined);
  provider.set(second, null);
  expectTypeOf(provider.get(first)).toEqualTypeOf<Auth<{ subject: string }> | null | undefined>();
  expectTypeOf(provider.get(second)).toEqualTypeOf<Auth<{ account: number }> | null | undefined>();
  const middleware = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    context: first,
    mapClaims: () => ({ subject: 'one' }),
    mode: 'optional',
    skip: () => false,
  });
  expectTypeOf(middleware).toEqualTypeOf<MiddlewareFunction<Response>>();
  const required = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    context: second,
    mapClaims: () => ({ account: 1 }),
  });
  expectTypeOf(required).toEqualTypeOf<MiddlewareFunction<Response>>();
  expect(() => {
    // @ts-expect-error the application context is mandatory
    jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api' });
  }).toThrow(ConfigurationError);

  jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    context: first,
    // @ts-expect-error one context cannot receive another identity type
    mapClaims: () => ({ account: 1 }),
  });
});
