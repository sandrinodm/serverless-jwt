import type { Auth } from '@serverless-jwt/jwt-verifier';
import type { createMiddleware as SolidMiddleware } from '@tanstack/solid-start';

import { createMiddleware as reactMiddleware } from '@tanstack/react-start';
import { createMiddleware } from '@tanstack/start-client-core';
import { expectTypeOf, it } from 'vite-plus/test';

import { jwtFunctionMiddleware, jwtMiddleware } from './index.ts';

it('preserves mapped identities two request-middleware levels down for both real framework APIs', () => {
  expectTypeOf<typeof createMiddleware>().toExtend<typeof SolidMiddleware>();
  expectTypeOf<typeof createMiddleware>().toExtend<typeof reactMiddleware>();
  const first = createMiddleware({ type: 'request' }).server(
    jwtMiddleware({
      issuer: 'https://issuer.example',
      audience: 'api',
      mapClaims: () => ({ subject: 'one' }),
    }),
  );
  const second = reactMiddleware({ type: 'request' })
    .middleware([first])
    .server(({ context, next }) => {
      expectTypeOf(context.auth).toEqualTypeOf<Auth<{ subject: string }>>();
      return next({ context: { account: context.auth.identity.subject } });
    });
  createMiddleware({ type: 'request' })
    .middleware([second])
    .server(({ context, next }) => {
      expectTypeOf(context.auth.identity.subject).toEqualTypeOf<string>();
      expectTypeOf(context.account).toEqualTypeOf<string>();
      // @ts-expect-error an unrelated identity cannot replace the inferred subject
      const wrong: number = context.auth.identity.subject;
      // @ts-expect-error propagated auth retains its exact identity
      void context.auth.identity.absent;
      void wrong;
      return next();
    });
});

it('preserves function identity, optional and explicit skip states with no client sendContext', () => {
  const fn = createMiddleware({ type: 'function' }).server(
    jwtFunctionMiddleware({
      issuer: 'https://issuer.example',
      audience: 'api',
      mapClaims: () => ({ account: 1 }),
    }),
  );
  const second = reactMiddleware({ type: 'function' })
    .middleware([fn])
    .server(({ context, next }) => {
      expectTypeOf(context.auth).toEqualTypeOf<Auth<{ account: number }>>();
      return next({ context: { account: context.auth.identity.account } });
    });
  createMiddleware({ type: 'function' })
    .middleware([second])
    .server(({ context, next }) => {
      expectTypeOf(context.auth.identity.account).toEqualTypeOf<number>();
      // @ts-expect-error independent identities do not merge globally
      void context.auth.identity.subject;
      return next();
    });
  expectTypeOf<(typeof fn)['~types']['allServerSendContext']>().toEqualTypeOf<undefined>();
  const optional = createMiddleware({ type: 'function' }).server(
    jwtFunctionMiddleware({ issuer: 'https://issuer.example', audience: 'api', mode: 'optional' }),
  );
  expectTypeOf<(typeof optional)['~types']['serverContext']['auth']>().toEqualTypeOf<Auth<
    Readonly<Record<string, unknown>>
  > | null>();
  const skipped = createMiddleware({ type: 'request' }).server(
    jwtMiddleware({
      issuer: 'https://issuer.example',
      audience: 'api',
      skip: (request) => request.header('x-public') === 'true',
    }),
  );
  expectTypeOf<(typeof skipped)['~types']['serverContext']['auth']>().toEqualTypeOf<
    Auth<Readonly<Record<string, unknown>>> | undefined
  >();
});
