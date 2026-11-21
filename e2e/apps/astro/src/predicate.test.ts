import { expect, it } from 'vite-plus/test';

import { contextFixture } from '../../../../packages/astro/src/context.test-helper.ts';
import { jwtMiddleware } from '../../../../packages/astro/src/index.ts';

it('executes explicitly registered predicates and observes invalid asynchronous results before failing closed', async () => {
  const context = contextFixture(new Request('https://astro.example/public'));
  const unprotected = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: () => false,
  });
  expect((await unprotected(context, async () => new Response('public'))).status).toBe(200);
  const protectedMiddleware = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: () => true,
  });
  expect(
    (
      await protectedMiddleware(context, async () => {
        throw new Error('Unexpected protected handler');
      })
    ).status,
  ).toBe(401);
  const invalid = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: (async () => {
      throw new Error('Invalid predicate rejection');
    }) as never,
  });
  const refused = await invalid(context, async () => {
    throw new Error('Unexpected invalid-policy handler');
  });
  expect(refused.status).toBe(500);
  expect(await refused.json()).toEqual({
    error: 'server_error',
    error_description: 'The authentication adapter is misconfigured.',
  });
  const throws = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: () => {
      throw new Error('Private predicate cause');
    },
  });
  const thrown = await throws(context, async () => {
    throw new Error('Unexpected throwing-policy handler');
  });
  expect(thrown.status).toBe(500);
  expect(await thrown.text()).not.toContain('Private predicate cause');
});
