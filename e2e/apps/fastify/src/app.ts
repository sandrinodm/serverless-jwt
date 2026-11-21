import { serverlessJwt, getAuth } from '@serverless-jwt/fastify';
import Fastify from 'fastify';

import { nodeCors, nodeStream } from '../capabilities.ts';

/**
 * Prefix encapsulation keeps the readiness sibling public while guarding all protected methods.
 */
const app = Fastify();
app.addHook('onRequest', async (request, reply): Promise<void> => {
  if (nodeCors(request.raw, reply.raw)) {
    reply.hijack();
  }
});
app.get('/ready', () => 'ready');
await app.register(
  async (api): Promise<void> => {
    await api.register(serverlessJwt, {
      issuer: process.env.ISSUER ?? 'https://issuer.example',
      audience: 'https://resource.example',
      global: true,
      ...(process.env.JWKS_URI ? { jwksUri: process.env.JWKS_URI } : {}),
    });
    api.all('/', (request, reply) => {
      if (new URL(request.url, 'http://localhost').searchParams.get('e2e_stream') === '1') {
        reply.hijack();
        nodeStream(request.raw, reply.raw, getAuth(request).claims.sub);
        return;
      }

      return {
        sub: getAuth(request).claims.sub,
        scopes: getAuth(request).scopes,
      };
    });
  },
  { prefix: '/protected' },
);
await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT) });
