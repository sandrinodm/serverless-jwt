import type { Context } from '@netlify/functions';
import type { Auth, VerifiedClaims } from '@serverless-jwt/jwt-verifier';

import { expectTypeOf, it } from 'vite-plus/test';

import { withJwt as edgeJwt } from './edge.ts';
import { withJwt as functionsJwt } from './index.ts';

it('uses actual platform Context and preserves two mapped identity types in both forms', () => {
  for (const withJwt of [functionsJwt, edgeJwt]) {
    const first = withJwt(
      { issuer: 'https://issuer.example', audience: 'api', mapClaims: () => ({ first: 'one' }) },
      (request, context, auth) => {
        expectTypeOf(request).toEqualTypeOf<Request>();
        expectTypeOf(context).toEqualTypeOf<Context>();
        expectTypeOf(auth).toEqualTypeOf<Auth<{ first: string }>>();
        return new Response();
      },
    );
    expectTypeOf(first).toEqualTypeOf<(request: Request, context: Context) => Promise<Response>>();
    withJwt(
      { issuer: 'https://issuer.example', audience: 'api', mapClaims: () => ({ second: 2 }) },
      (_request, _context, auth) => {
        expectTypeOf(auth).toEqualTypeOf<Auth<{ second: number }>>();
        return new Response();
      },
    );
    withJwt(
      { issuer: 'https://issuer.example', audience: 'api', mode: 'optional' },
      (_request, _context, auth) => {
        expectTypeOf(auth).toEqualTypeOf<Auth<VerifiedClaims> | null>();
        return new Response();
      },
    );
    withJwt(
      { issuer: 'https://issuer.example', audience: 'api', skip: () => true },
      (_request, _context, auth) => {
        expectTypeOf(auth).toEqualTypeOf<Auth<VerifiedClaims> | undefined>();
        return new Response();
      },
    );
  }
});
