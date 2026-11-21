/// <reference types="node" />
import { H3 } from 'h3';
import type { H3Event } from 'h3';
import type { Auth } from '@serverless-jwt/jwt-verifier';
import { jwtMiddleware, getAuth } from '@serverless-jwt/nuxt/h3-v2';
const app = new H3();
app.use(jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api', protect: ['/api/**'] }));
app.get('/api/me', (event) => { const auth: Auth<{ readonly subject: string }> = getAuth(event); return auth.identity; });
// @ts-expect-error protection policy is mandatory
jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api' });

app.use(jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api', protect: (event: H3Event) => event.url.pathname === '/protected', onError: (_error, event) => { const native: H3Event = event; void native.url; return undefined; } }));
const structural = jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api', protect: (event) => {
  const request: Request = event.req;
  // @ts-expect-error default structural context does not promise the full SDK's URL property
  void event.url;
  return request.method === 'POST';
} });
app.use(structural);
app.use(jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api', protect: (event) => event.url.pathname === '/contextually-typed' }));
// @ts-expect-error protection predicates must be synchronous
jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api', protect: async (_event: H3Event) => true });
// @ts-expect-error protection predicates must return booleans
jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api', protect: (_event: H3Event) => 'yes' });
const narrow = jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api', protect: (event: H3Event & { readonly extra: string }) => event.extra === 'yes' });
// @ts-expect-error native h3 does not promise application-invented event fields
app.use(narrow);
