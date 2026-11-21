import { expect, it } from 'vite-plus/test';

import { contextFixture } from './context.test-helper.ts';
import { withJwt as edgeJwt } from './edge.ts';
import { withJwt as functionsJwt } from './index.ts';

for (const [form, withJwt] of [
  ['functions', functionsJwt],
  ['edge', edgeJwt],
] as const) {
  it(
    form + ' rejects joined native credential pairs in both orders before any key request',
    async () => {
      let fetches = 0;
      const route = withJwt(
        {
          issuer: 'https://issuer.example',
          audience: 'api',
          fetch: async (): Promise<Response> => {
            fetches++;
            return new Response();
          },
        },
        (): Response => {
          throw new Error('Unauthorized handler invocation');
        },
      );
      for (const values of [
        ['Bearer one', 'Basic two'],
        ['Basic two', 'Bearer one'],
      ]) {
        const request = new Request('https://netlify.example/api', {
          headers: values.map((value) => ['Authorization', value]),
        });
        expect((await route(request, contextFixture())).status).toBe(400);
      }

      expect(fetches).toBe(0);
    },
  );

  it(
    form +
      ' preserves the original platform request and context when an explicit skip permits access',
    async () => {
      const request = new Request('https://netlify.example/api', {
        headers: { 'x-test': 'header-view' },
      });
      const context = contextFixture();
      const route = withJwt(
        {
          issuer: 'https://issuer.example',
          audience: 'api',
          skip: (view) => {
            expect(view.header('missing')).toBeUndefined();
            expect(view.header('x-test')).toBe('header-view');
            return true;
          },
        },
        (original, passed, auth): Response => {
          expect(original).toBe(request);
          expect(passed).toBe(context);
          expect(auth).toBeUndefined();
          return new Response('permitted');
        },
      );
      expect(await (await route(request, context)).text()).toBe('permitted');
    },
  );
}
