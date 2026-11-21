import { NextRequest } from 'next/server.js';
import { expect, it } from 'vite-plus/test';

import { signingKey } from '../../testkit/src/keys.ts';
import { mintToken } from '../../testkit/src/tokens.ts';
import { createProxyGuard, withJwt } from './index.ts';

it('retains one verifier cache and the exact params promise across repeated requests', async () => {
  const key = await signingKey();
  const token = await mintToken({
    key,
    header: {},
    payload: {
      iss: 'https://issuer.example',
      aud: 'api',
      sub: 'one',
      exp: Math.floor(Date.now() / 1000) + 300,
    },
  });
  let fetches = 0;
  const request = new NextRequest('https://resource.example/api/one', {
    headers: { authorization: 'Bearer ' + token },
  });
  const params = Promise.resolve({ id: 'one' });
  const context = { params, extra: Symbol('original') };
  const route = withJwt(
    {
      issuer: 'https://issuer.example',
      audience: 'api',
      jwksUri: 'https://issuer.example/jwks',
      fetch: async () => {
        fetches++;
        return Response.json({ keys: [key.jwk] });
      },
    },
    (original, passed: typeof context, auth) => {
      expect(original).toBe(request);
      expect(passed).toBe(context);
      expect(passed.params).toBe(params);
      expect(auth.claims.sub).toBe('one');
      return Response.json({});
    },
  );
  await route(request, context);
  await route(request, context);
  expect(fetches).toBe(1);
});

it('reads actual Next headers in skip and never mutates request auth headers', async () => {
  const request = new NextRequest('https://resource.example/api', {
    headers: { 'x-probe': 'present', 'x-auth-sub': 'spoofed' },
  });
  const headers = [...request.headers];
  const policy = {
    issuer: 'https://issuer.example',
    audience: 'api',
    skip: (view: { readonly header: (name: string) => string | undefined }): boolean => {
      expect(view.header('x-probe')).toBe('present');
      expect(view.header('missing')).toBeUndefined();
      return true;
    },
  };
  const route = withJwt(policy, (_request, _ctx, auth) => {
    expect(auth).toBeUndefined();
    return Response.json({});
  });
  expect((await route(request, { params: Promise.resolve({}) })).status).toBe(200);
  const proxy = createProxyGuard(policy);
  expect(await proxy(request)).toBeUndefined();
  expect([...request.headers]).toEqual(headers);
});

it('rejects both orders of joined header pairs in real NextRequest objects before any handler', async () => {
  const options = { issuer: 'https://issuer.example', audience: 'api' };
  let entered = false;
  const route = withJwt(options, () => {
    entered = true;
    return Response.json({});
  });
  const proxy = createProxyGuard(options);
  for (const values of [
    ['Bearer invalid', 'Basic other'],
    ['Basic other', 'Bearer invalid'],
  ]) {
    const request = new NextRequest('https://resource.example/api', {
      headers: values.map((value) => ['authorization', value]),
    });
    expect((await route(request, { params: Promise.resolve({}) })).status).toBe(400);
    expect((await proxy(request))?.status).toBe(400);
  }

  expect(entered).toBe(false);
});
