import {
  ConfigurationError,
  createJwtVerifier,
  JwtVerifierError,
} from '@serverless-jwt/jwt-verifier';
import { expect, it } from 'vite-plus/test';

import { contextFixture } from './context.test-helper.ts';
import { jwtMiddleware, requireAuth } from './index.ts';

it('rejects absent or mismatched protection before returning middleware', () => {
  for (const protect of [undefined, null, {}, [], ['/other/**'], () => true]) {
    expect(() =>
      jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api', protect } as never),
    ).toThrow(ConfigurationError);
  }
});

it('keeps unprotected contexts public and removes stale auth on that request', async () => {
  const middleware = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: ['/api/**'],
  });
  const context = contextFixture(new Request('https://astro.example/public'));
  Object.assign(context.locals, { auth: { stale: true } });
  const response = await middleware(context, async () => {
    expect(context.locals.auth).toBeUndefined();
    return new Response('public');
  });
  expect(await response.text()).toBe('public');
  expect(() => requireAuth(context.locals)).toThrow(JwtVerifierError);
  const auth = {
    token: 'synthetic-token',
    claims: {},
    identity: { subject: 'one' },
    scopes: ['read'],
  };
  expect(requireAuth<{ subject: string }>({ auth })).toBe(auth);
});

it('normalizes encoded aliases without rewriting context and provides the original error-hook context', async () => {
  const context = contextFixture(new Request('https://astro.example/%2561pi/me'));
  const middleware = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: ['/api/**'],
    onError: (_failure, original) => {
      expect(original).toBe(context);
      return new Response('custom', { status: 401 });
    },
  });
  expect(
    (
      await middleware(context, async () => {
        throw new Error('Unexpected protected handler');
      })
    ).status,
  ).toBe(401);
  expect(context.url.pathname).toBe('/%2561pi/me');
});

it('validates malformed paths before auth/next and retains exact safe 400 responses', async () => {
  let checked = 0;
  const middleware = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: ['/api/**'],
    skip: () => {
      checked++;
      return true;
    },
  });
  const response = await middleware(
    contextFixture(new Request('https://astro.example/%q0')),
    async () => {
      throw new Error('Unexpected malformed-path handler');
    },
  );
  expect(response.status).toBe(400);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).toBe('Invalid request pathname.');
  expect(checked).toBe(0);
});

it('rejects joined credential pairs in both orders and forwards explicit skips without shared auth', async () => {
  const middleware = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: ['/api/**'],
  });
  for (const values of [
    ['Bearer one', 'Basic two'],
    ['Basic two', 'Bearer one'],
  ]) {
    const response = await middleware(
      contextFixture(
        new Request('https://astro.example/api/me', {
          headers: values.map((value) => ['Authorization', value]),
        }),
      ),
      async () => {
        throw new Error('Unexpected credential handler');
      },
    );
    expect(response.status).toBe(400);
  }

  const skipped = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: ['/api/**'],
    skip: (request) => {
      expect(request.header('x-test')).toBe('value');
      expect(request.header('missing')).toBeUndefined();
      return true;
    },
  });
  const context = contextFixture(
    new Request('https://astro.example/api/me', { headers: { 'x-test': 'value' } }),
  );
  await skipped(context, async () => {
    expect(context.locals.auth).toBeUndefined();
    return new Response();
  });
});

it('uses the endpoint bare challenge for absent or optional auth and preserves unrelated route errors', async () => {
  const middleware = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: ['/api/**'],
  });
  for (const auth of [undefined, null]) {
    const context = contextFixture(new Request('https://astro.example/endpoint-auth'));
    const response = await middleware(context, async () => {
      Object.assign(context.locals, { auth });
      requireAuth(context.locals);
      return new Response('unreachable');
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer realm="api"');
    expect(response.headers.get('cache-control')).toBe('no-store');
  }

  for (const failure of [
    new Error('original route error'),
    new JwtVerifierError('missing_token'),
  ]) {
    const context = contextFixture(new Request('https://astro.example/public'));
    await expect(
      middleware(context, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  }
});

it('snapshots the configured endpoint realm and retains the default with an existing verifier', async () => {
  const options = {
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: ['/api/**'],
    realm: 'private "realm"\\zone',
  };
  const configured = jwtMiddleware(options);
  options.realm = 'mutated';
  const existing = jwtMiddleware({
    verifier: createJwtVerifier({
      issuer: options.issuer,
      audience: 'api',
      realm: 'verifier private',
    }),
    protect: ['/api/**'],
  });
  for (const [middleware, challenge] of [
    [configured, 'Bearer realm="private \\"realm\\"\\\\zone"'],
    [existing, 'Bearer realm="api"'],
  ] as const) {
    const context = contextFixture(new Request('https://astro.example/endpoint-auth'));
    const response = await middleware(context, async () => {
      requireAuth(context.locals);
      return new Response('unreachable');
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(challenge);
    expect(response.headers.get('cache-control')).toBe('no-store');
  }
});
