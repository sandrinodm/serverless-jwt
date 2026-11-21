import type { RequestInfoLike } from '@serverless-jwt/jwt-verifier/adapter';

import { Hono } from 'hono';
import { expect, it } from 'vite-plus/test';

import type { JwtEnv } from './index.ts';

import { signingKey } from '../../testkit/src/keys.ts';
import { mintToken } from '../../testkit/src/tokens.ts';
import { jwt } from './index.ts';

it('creates one verifier cache and keeps original native request/context environment', async () => {
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
  const app = new Hono<JwtEnv & { readonly Bindings: { readonly marker: string } }>();
  app.use(
    '*',
    jwt({
      issuer: 'https://issuer.example',
      audience: 'api',
      jwksUri: 'https://issuer.example/jwks',
      fetch: async () => {
        fetches++;
        return Response.json({ keys: [key.jwk] });
      },
    }),
  );
  app.get('/api', (context) =>
    context.json({ sub: context.var.auth.claims.sub, marker: context.env.marker }),
  );
  const request = new Request('https://hono.example/api', {
    headers: { authorization: 'Bearer ' + token },
  });
  const env = { marker: 'original' };
  expect(await (await app.request(request, {}, env)).json()).toEqual({
    sub: 'one',
    marker: 'original',
  });
  expect((await app.request(request, {}, env)).status).toBe(200);
  expect(fetches).toBe(1);
});

it('uses the cheap real-header skip view and supplies undefined', async () => {
  const app = new Hono<JwtEnv<unknown, 'required', (request: RequestInfoLike) => boolean>>();
  app.use(
    '*',
    jwt({
      issuer: 'https://issuer.example',
      audience: 'api',
      skip: (view) => {
        expect(view.header('x-probe')).toBe('present');
        expect(view.header('missing')).toBeUndefined();
        return true;
      },
    }),
  );
  app.get('/api', (context) => context.json({ absent: context.var.auth === undefined }));
  expect(await (await app.request('/api', { headers: { 'x-probe': 'present' } })).json()).toEqual({
    absent: true,
  });
});

it('preserves finalized hook responses and reports failure without writing a fallback body', async () => {
  for (const failure of [false, true]) {
    const app = new Hono();
    const events: unknown[] = [];
    app.use(
      '*',
      jwt({
        issuer: 'https://issuer.example',
        audience: 'api',
        onIntegrationDiagnostic: (event) => events.push(event),
        onError: (_error, context) => {
          context.res = new Response('committed', { status: 418 });
          if (failure) {
            throw null;
          }

          return new Response('other', { status: 419 });
        },
      }),
    );
    app.get('/api', (context) => context.text('protected'));
    const response = await app.request('/api');
    expect(response.status).toBe(418);
    expect(await response.text()).toBe('committed');
    expect(events).toHaveLength(failure ? 1 : 0);
  }
});
