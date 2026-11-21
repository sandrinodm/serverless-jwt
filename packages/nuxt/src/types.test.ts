import type { Auth } from '@serverless-jwt/jwt-verifier';
import type { H3Event } from 'h3';
import type { H3Event as H3WebEvent } from 'h3-v2';

/// <reference types="node" />
import { createApp, defineEventHandler } from 'h3';
import { H3 } from 'h3-v2';
import { it, expect } from 'vite-plus/test';

import { jwtMiddleware as webMiddleware } from './h3-v2.ts';
import { jwtMiddleware, getAuth } from './index.ts';

it('compiles the README against real framework types', () => {
  const compile = async (): Promise<void> => {
    const app = createApp();
    app.use(
      jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api', protect: ['/api/**'] }),
    );
    app.use(
      '/api/me',
      defineEventHandler((event) => {
        const auth: Auth<{ readonly subject: string }> = getAuth(event);
        return auth.identity;
      }),
    );
    app.use(
      jwtMiddleware({
        issuer: 'https://issuer.example',
        audience: 'api',
        protect: (event: H3Event) => event.node.req.method === 'GET',
      }),
    );
    jwtMiddleware({
      issuer: 'https://issuer.example',
      audience: 'api',
      // @ts-expect-error protection predicates are synchronous
      protect: async (_event: H3Event) => true,
    });
    const web = new H3();
    web.use(
      webMiddleware({
        issuer: 'https://issuer.example',
        audience: 'api',
        protect: (event: H3WebEvent) => event.url.pathname === '/protected',
      }),
    );
    web.use(
      webMiddleware({
        issuer: 'https://issuer.example',
        audience: 'api',
        protect: (event) => event.req.method === 'POST',
      }),
    );
    webMiddleware({
      issuer: 'https://issuer.example',
      audience: 'api',
      // @ts-expect-error native v1 events cannot be supplied by a v2 host
      protect: (event: H3Event) => event.node.req.method === 'GET',
    });
    webMiddleware({
      issuer: 'https://issuer.example',
      audience: 'api',
      // @ts-expect-error protection predicates must return booleans
      protect: (_event: H3WebEvent) => 'yes',
    });
    const structural = webMiddleware({
      issuer: 'https://issuer.example',
      audience: 'api',
      protect: (event) => {
        // @ts-expect-error standalone default event does not promise full SDK URL fields
        void event.url;
        return event.req.method === 'POST';
      },
    });
    web.use(structural);
    web.use(
      webMiddleware({
        issuer: 'https://issuer.example',
        audience: 'api',
        protect: (event) => event.url.pathname === '/contextually-typed',
      }),
    );
    const narrow = webMiddleware({
      issuer: 'https://issuer.example',
      audience: 'api',
      protect: (event: H3WebEvent & { readonly extra: string }) => event.extra === 'yes',
    });
    // @ts-expect-error native h3 does not promise application-invented event fields
    web.use(narrow);
    // @ts-expect-error protection policy is mandatory
    jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api' });
  };
  expect(compile).toBeTypeOf('function');
});
