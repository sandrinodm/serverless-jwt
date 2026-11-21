/// <reference types="node" />
import { createApp, defineEventHandler } from 'h3';
import type { H3Event } from 'h3';
import type { Auth } from '@serverless-jwt/jwt-verifier';
import { jwtMiddleware, getAuth } from '@serverless-jwt/nuxt';
const app = createApp();
app.use(jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api', protect: ['/api/**'] }));
app.use('/api/me', defineEventHandler((event) => { const auth: Auth<{ readonly subject: string }> = getAuth(event); return auth.identity; }));
// @ts-expect-error protection policy is mandatory
jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api' });

app.use(jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api', protect: (event) => {
  const native: H3Event = event;
  return native.node.req.method === 'GET';
} }));
// @ts-expect-error protection predicates must be synchronous
jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api', protect: async (_event: H3Event) => true });
// @ts-expect-error protection predicates must return booleans
jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api', protect: (_event: H3Event) => 'yes' });
