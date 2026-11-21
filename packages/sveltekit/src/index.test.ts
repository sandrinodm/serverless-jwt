import { ConfigurationError, createJwtVerifier } from '@serverless-jwt/jwt-verifier';
import { isHttpError } from '@sveltejs/kit';
import assert from 'node:assert/strict';
import { expect, it } from 'vite-plus/test';

import { eventFixture } from './event.test-helper.ts';
import { jwtHandle, requireAuth } from './index.ts';

it('rejects absent or mismatched protection synchronously before returning a handle', () => {
  for (const protect of [undefined, null, {}, [], ['/other/**'], () => true]) {
    expect(() =>
      jwtHandle({ issuer: 'https://issuer.example', audience: 'api', protect } as never),
    ).toThrow(ConfigurationError);
  }
});

it('keeps unprotected routes public and clears stale request-local auth', async () => {
  const handle = jwtHandle({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: ['/api/**'],
  });
  const event = eventFixture(new Request('https://sveltekit.example/public'));
  Object.assign(event.locals, { auth: { stale: true } });
  const response = await handle({
    event,
    resolve: async (original) => {
      expect(original).toBe(event);
      expect(event.locals.auth).toBeUndefined();
      return new Response('public');
    },
  });
  expect(await response.text()).toBe('public');
  assert.throws(
    () => requireAuth(event.locals),
    (failure: unknown) =>
      isHttpError(failure) &&
      failure.status === 401 &&
      failure.body.message === 'Authentication required',
  );
});

it('protects encoded routing aliases without mutating the platform URL and exposes header views', async () => {
  const handle = jwtHandle({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: ['/api/**'],
    skip: (view) => {
      expect(view.header('x-test')).toBe('test');
      expect(view.header('missing')).toBeUndefined();
      return true;
    },
  });
  const event = eventFixture(
    new Request('https://sveltekit.example/%61pi/me', { headers: { 'x-test': 'test' } }),
  );
  await handle({
    event,
    resolve: async (original) => {
      expect(original.url.pathname).toBe('/%61pi/me');
      expect(original.locals.auth).toBeUndefined();
      return new Response();
    },
  });
});

it('rejects native joined Authorization pairs in both orders', async () => {
  const handle = jwtHandle({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: ['/api/**'],
  });
  for (const values of [
    ['Bearer one', 'Basic two'],
    ['Basic two', 'Bearer one'],
  ]) {
    const event = eventFixture(
      new Request('https://sveltekit.example/api/me', {
        headers: values.map((value) => ['Authorization', value]),
      }),
    );
    const response = await handle({
      event,
      resolve: async () => {
        throw new Error('Unexpected protected handler');
      },
    });
    expect(response.status).toBe(400);
  }
});

it('rejects malformed paths with the exact safe response before auth policy or downstream resolution', async () => {
  let authChecks = 0;
  let resolved = 0;
  const handle = jwtHandle({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: ['/api/**'],
    skip: () => {
      authChecks++;
      return false;
    },
  });
  for (const path of ['/%E0%A4%A', '/%q0']) {
    const response = await handle({
      event: eventFixture(
        new Request('https://sveltekit.example' + path, {
          headers: { authorization: 'Bearer one.two.three' },
        }),
      ),
      resolve: async () => {
        resolved++;
        return new Response('private');
      },
    });
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('Invalid request pathname.');
  }

  expect(authChecks).toBe(0);
  expect(resolved).toBe(0);
});

it('checks auth presence and preserves the exact identity object without globally narrowing locals', () => {
  const auth = {
    token: 'synthetic-unit-token',
    claims: { sub: 'one' },
    identity: { subject: 'one' },
    scopes: ['read'],
  };
  expect(requireAuth<{ subject: string }>({ auth })).toBe(auth);
});

it('adds endpoint headers through the request binding and restores nested bindings without retaining locals', async () => {
  const handle = jwtHandle({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: ['/api/**'],
  });
  for (const auth of [undefined, null]) {
    const headers: Record<string, string> = {};
    let written = 0;
    const event = eventFixture(new Request('https://sveltekit.example/endpoint-auth'));
    Object.assign(event, {
      setHeaders: (values: Record<string, string>) => {
        Object.assign(headers, values);
        written++;
      },
    });
    const response = await handle({
      event,
      resolve: async () => {
        // A nested handle finishes first; the original request header writer must be restored.
        await handle({ event, resolve: async () => new Response('nested') });
        Object.assign(event.locals, { auth });
        try {
          requireAuth(event.locals);
        } catch (failure) {
          if (isHttpError(failure)) {
            return new Response(failure.body.message, { status: failure.status });
          }

          throw failure;
        }

        return new Response('unreachable');
      },
    });
    expect(response.status).toBe(401);
    expect(headers['www-authenticate']).toBe('Bearer realm="api"');
    expect(headers['cache-control']).toBe('no-store');
    expect(written).toBe(1);
    assert.throws(
      () => requireAuth(event.locals),
      (failure: unknown) => isHttpError(failure) && failure.status === 401,
    );
    expect(written).toBe(1);
  }

  const failure = new Error('original route error');
  const event = eventFixture(new Request('https://sveltekit.example/public'));
  await expect(
    handle({
      event,
      resolve: async () => {
        throw failure;
      },
    }),
  ).rejects.toBe(failure);
});

it('snapshots the configured endpoint realm and retains the default with an existing verifier', async () => {
  const options = {
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: ['/api/**'],
    realm: 'private "realm"\\zone',
  };
  const configured = jwtHandle(options);
  options.realm = 'mutated';
  const existing = jwtHandle({
    verifier: createJwtVerifier({
      issuer: options.issuer,
      audience: 'api',
      realm: 'verifier private',
    }),
    protect: ['/api/**'],
  });
  for (const [handle, challenge] of [
    [configured, 'Bearer realm="private \\"realm\\"\\\\zone"'],
    [existing, 'Bearer realm="api"'],
  ] as const) {
    const headers: Record<string, string> = {};
    const event = eventFixture(new Request('https://sveltekit.example/endpoint-auth'));
    Object.assign(event, {
      setHeaders: (values: Record<string, string>) => Object.assign(headers, values),
    });
    await handle({
      event,
      resolve: async () => {
        assert.throws(
          () => requireAuth(event.locals),
          (failure: unknown) => isHttpError(failure) && failure.status === 401,
        );
        return new Response(null, { status: 401 });
      },
    });
    expect(headers['www-authenticate']).toBe(challenge);
    expect(headers['cache-control']).toBe('no-store');
  }
});
