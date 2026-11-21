import { expect, expectTypeOf, it } from 'vite-plus/test';

import type { RequestHandler } from './routes/api/me/$types.d.ts';

import { eventFixture } from '../../../../packages/sveltekit/src/event.test-helper.ts';
import { jwtHandle } from '../../../../packages/sveltekit/src/index.ts';

it('retains actual native generated endpoint route types', () => {
  expectTypeOf<Parameters<RequestHandler>[0]['route']['id']>().toEqualTypeOf<'/api/me'>();
});

it('executes explicitly registered predicates and observes invalid asynchronous results before failing closed', async () => {
  const event = eventFixture(new Request('https://sveltekit.example/public'));
  const unprotected = jwtHandle({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: () => false,
  });
  expect((await unprotected({ event, resolve: async () => new Response('public') })).status).toBe(
    200,
  );
  const protectedHandle = jwtHandle({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: () => true,
  });
  expect(
    (
      await protectedHandle({
        event,
        resolve: async () => {
          throw new Error('Unexpected protected resolver');
        },
      })
    ).status,
  ).toBe(401);
  const invalid = jwtHandle({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: (async () => {
      throw new Error('Invalid predicate rejection');
    }) as never,
  });
  const refused = await invalid({
    event,
    resolve: async () => {
      throw new Error('Unexpected invalid-policy resolver');
    },
  });
  expect(refused.status).toBe(500);
  expect(await refused.json()).toEqual({
    error: 'server_error',
    error_description: 'The authentication adapter is misconfigured.',
  });
  const throws = jwtHandle({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: () => {
      throw new Error('Private predicate cause');
    },
  });
  const thrown = await throws({
    event,
    resolve: async () => {
      throw new Error('Unexpected throwing-policy resolver');
    },
  });
  expect(thrown.status).toBe(500);
  expect(await thrown.text()).not.toContain('Private predicate cause');
});
