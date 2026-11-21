import { expect, it } from 'vite-plus/test';

import { signingKey } from '../../testkit/src/keys.ts';
import { mintToken } from '../../testkit/src/tokens.ts';
import { withJwt } from './index.ts';

it('keeps auth in the third slot with or without the original second argument and reuses one verifier', async () => {
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
  const request = new Request('https://vercel.example/api', {
    headers: { authorization: 'Bearer ' + token },
  });
  const context = { original: true };
  const values: unknown[] = [];
  const guarded = withJwt(
    {
      issuer: 'https://issuer.example',
      audience: 'api',
      jwksUri: 'https://issuer.example/jwks',
      fetch: async () => {
        fetches++;
        return Response.json({ keys: [key.jwk] });
      },
    },
    function (original, passed: typeof context | undefined, auth): Response {
      expect(arguments).toHaveLength(3);
      expect(original).toBe(request);
      expect(auth.claims.sub).toBe('one');
      values.push(passed);
      return Response.json({});
    },
  );
  expect((await guarded(request, context)).status).toBe(200);
  expect((await guarded(request)).status).toBe(200);
  expect(values).toEqual([context, undefined]);
  expect(fetches).toBe(1);
});

it('preserves native header views and rejects joined duplicate pairs in both orders', async () => {
  const options = { issuer: 'https://issuer.example', audience: 'api' };
  const guarded = withJwt(options, () => Response.json({}));
  for (const values of [
    ['Bearer invalid', 'Basic other'],
    ['Basic other', 'Bearer invalid'],
  ]) {
    expect(
      (
        await guarded(
          new Request('https://vercel.example/api', {
            headers: values.map((value) => ['authorization', value]),
          }),
        )
      ).status,
    ).toBe(400);
  }

  const skip = withJwt(
    {
      ...options,
      skip: (view) => {
        expect(view.header('x-probe')).toBe('present');
        expect(view.header('missing')).toBeUndefined();
        return true;
      },
    },
    (_request, context, auth) => {
      expect(context).toBeUndefined();
      expect(auth).toBeUndefined();
      return Response.json({});
    },
  );
  expect(
    (await skip(new Request('https://vercel.example/api', { headers: { 'x-probe': 'present' } })))
      .status,
  ).toBe(200);
});
