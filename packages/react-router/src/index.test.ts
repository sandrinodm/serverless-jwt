import { ConfigurationError } from '@serverless-jwt/jwt-verifier';
import { RouterContextProvider } from 'react-router';
import { expect, it } from 'vite-plus/test';

import type { ReactRouterOptions } from './index.ts';

import { createAuthContext, jwtMiddleware } from './index.ts';

it('requires an explicit context before creating working middleware', () => {
  for (const context of [undefined, null, 'invalid']) {
    expect(() =>
      jwtMiddleware({
        issuer: 'https://issuer.example',
        audience: 'api',
        context,
      } as unknown as ReactRouterOptions),
    ).toThrow(ConfigurationError);
  }
});

it('preserves native arguments, downstream results and app-owned independent contexts', async () => {
  const first = createAuthContext<{ subject: string }>();
  const second = createAuthContext<{ account: number }>();
  const context = new RouterContextProvider();
  const request = new Request('https://router.example/api');
  const args = {
    request,
    context,
    params: { id: 'one' },
    url: new URL(request.url),
    pattern: '/api/:id',
  };
  const middleware = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    context: first,
    skip: () => true,
  });
  const result = new Response('application result');
  expect(await middleware(args, async () => result)).toBe(result);
  expect(context.get(first)).toBeUndefined();
  expect(() => context.get(second)).toThrow('No value found for context');
  const failure = new Error('application failure');
  await expect(
    middleware(args, async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
});

it('exposes original normalized native headers to deliberate synchronous skip policies', async () => {
  const context = new RouterContextProvider();
  const auth = createAuthContext();
  const request = new Request('https://router.example/api', { headers: { 'x-policy': 'public' } });
  const args = { request, context, params: {}, url: new URL(request.url), pattern: '/api' };
  const middleware = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    context: auth,
    skip: (info) => {
      expect(info.header('x-policy')).toBe('public');
      expect(info.header('x-absent')).toBeUndefined();
      return true;
    },
  });
  const response = new Response('deliberately public');
  expect(await middleware(args, async () => response)).toBe(response);
  expect(context.get(auth)).toBeUndefined();
});
