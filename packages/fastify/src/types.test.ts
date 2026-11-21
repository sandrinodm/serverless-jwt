import type { Auth } from '@serverless-jwt/jwt-verifier';

/// <reference types="node" />
import Fastify from 'fastify';
import { it, expect } from 'vite-plus/test';

import { serverlessJwt, getAuth } from './index.ts';

it('compiles the README against real framework types', () => {
  const compile = async (): Promise<void> => {
    const app = Fastify();
    await app.register(serverlessJwt, {
      issuer: 'https://issuer.example',
      audience: 'api',
      mapClaims: () => ({ subject: 'one' }),
    });
    app.get('/api/me', { onRequest: app.authenticate }, (request) => {
      const auth: Auth<{ readonly subject: string }> = getAuth(request);
      // @ts-expect-error global auth cannot claim one factory's identity
      void request.auth.identity.subject;
      return auth.identity;
    });
    await app.register(
      async (api) => {
        await api.register(serverlessJwt, {
          issuer: 'https://issuer.example',
          audience: 'api',
          global: true,
        });
        api.get('/me', (request) => getAuth(request).identity);
      },
      { prefix: '/api' },
    );
  };
  expect(compile).toBeTypeOf('function');
});
