import type { RequestInfoLike } from '@serverless-jwt/jwt-verifier/adapter';

import { JwtVerifierError } from '@serverless-jwt/jwt-verifier';
import { H3 } from 'h3-v2';
import { expect, it } from 'vite-plus/test';

import { getAuth, jwtMiddleware } from './h3-v2.ts';

it('checks typed auth contexts and honors mandatory protected paths in actual h3 v2 middleware', async () => {
  for (const optional of [false, true]) {
    const skip = (view: RequestInfoLike): boolean => {
      expect(view.header('x-probe')).toBe('present');
      expect(view.header('absent')).toBeUndefined();
      return true;
    };
    const app = new H3({ silent: true });
    app.use(
      jwtMiddleware({
        issuer: 'https://issuer.example',
        audience: 'api',
        protect: ['/protected'],
        ...(optional ? { mode: 'optional' as const } : { skip }),
      }),
    );
    app.all('/protected', (event) => {
      expect((event.context as { auth?: unknown }).auth).toBe(optional ? null : undefined);
      expect(() => getAuth(event)).toThrow(JwtVerifierError);
      return 'unauthed';
    });
    app.get('/public', (event) => {
      expect(() => getAuth(event)).toThrow(JwtVerifierError);
      return 'public';
    });
    expect((await app.fetch(new Request('https://resource.example/public'))).status).toBe(200);
    expect(
      (
        await app.fetch(
          new Request('https://resource.example/protected', { headers: { 'x-probe': 'present' } }),
        )
      ).status,
    ).toBe(200);
  }

  const auth = { identity: { id: 'one' } };
  expect(getAuth({ req: new Request('https://resource.example'), context: { auth } })).toBe(auth);
});

it('returns a fixed malformed-path response when a host permits malformed routing encodings', async () => {
  const middleware = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: ['/protected'],
  });
  const response = await middleware({
    req: new Request('https://resource.example/bad%'),
    context: {},
  });
  expect(response?.status).toBe(400);
  expect(await response?.text()).toBe('Invalid request pathname.');
});
