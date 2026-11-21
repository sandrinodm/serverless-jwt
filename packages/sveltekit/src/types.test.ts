import type { Auth } from '@serverless-jwt/jwt-verifier';
import type { Handle } from '@sveltejs/kit/hooks';

import { ConfigurationError } from '@serverless-jwt/jwt-verifier';
import { expect, expectTypeOf, it } from 'vite-plus/test';

import type { requireAuth } from './index.ts';

import { jwtHandle } from './index.ts';

it('uses actual Handle and honest global locals while checked accessors retain two application identities', () => {
  const first = jwtHandle({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: ['/api/**'],
    mapClaims: () => ({ subject: 'one' }),
  });
  expectTypeOf(first).toEqualTypeOf<Handle>();
  expectTypeOf<App.Locals['auth']>().toEqualTypeOf<Auth<unknown> | null | undefined>();
  expectTypeOf<ReturnType<typeof requireAuth<{ first: string }>>>().toEqualTypeOf<
    Auth<{ first: string }>
  >();
  expectTypeOf<ReturnType<typeof requireAuth<{ second: number }>>>().toEqualTypeOf<
    Auth<{ second: number }>
  >();
  jwtHandle({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: ['/api/**'],
    mode: 'optional',
    skip: () => false,
  });
  expect(() => {
    // @ts-expect-error protection is mandatory in the public factory contract
    jwtHandle({ issuer: 'https://issuer.example', audience: 'api' });
  }).toThrow(ConfigurationError);
});
