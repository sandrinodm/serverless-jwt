import { ConfigurationError } from '@serverless-jwt/jwt-verifier';
import { FastResponse } from 'srvx';
import { expect, it, vi } from 'vite-plus/test';

import type { RequestJwtMiddleware } from './index.ts';

import { jwtFunctionMiddleware, jwtMiddleware } from './index.ts';

it('fails closed with the actual Nitro FastResponse constructor before creating either callback', () => {
  vi.stubGlobal('Response', FastResponse);
  for (const create of [
    () => jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api' }),
    () => jwtFunctionMiddleware({ issuer: 'https://issuer.example', audience: 'api' }),
  ]) {
    expect(create).toThrow(ConfigurationError);
    expect(create).toThrow(
      expect.objectContaining({ reason: 'TanStack Start requires native Response semantics' }),
    );
  }
});

it('rechecks actual Response semantics when Nitro replaces the global after factory evaluation', async () => {
  const callback = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    skip: () => true,
  });
  vi.stubGlobal('Response', FastResponse);
  const args: Parameters<RequestJwtMiddleware<unknown>>[0] = {
    request: new Request('https://start.example/api'),
    pathname: '/api',
    context: undefined,
    handlerType: 'router',
    next: async () => {
      throw new Error('Downstream must not run');
    },
  };
  await expect(callback(args)).rejects.toThrow(ConfigurationError);
});

it('preserves native original headers for deliberate synchronous skip policies', async () => {
  const callback = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    skip: (request) => {
      expect(request.header('x-public')).toBe('yes');
      expect(request.header('x-missing')).toBeUndefined();
      return false;
    },
  });
  const args: Parameters<RequestJwtMiddleware<unknown>>[0] = {
    request: new Request('https://start.example/api', { headers: { 'x-public': 'yes' } }),
    pathname: '/api',
    context: undefined,
    handlerType: 'router',
    next: async () => {
      throw new Error('Downstream must not run');
    },
  };
  const response = await callback(args);
  expect(response).toBeInstanceOf(Response);
  if (!(response instanceof Response)) {
    throw new Error('Expected the missing-credential response');
  }

  expect(response.status).toBe(401);
});
