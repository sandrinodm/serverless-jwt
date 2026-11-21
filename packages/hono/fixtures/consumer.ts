import type { Auth } from '@serverless-jwt/jwt-verifier';
import type { MiddlewareHandler } from 'hono';

import { jwt, type JwtEnv } from '@serverless-jwt/hono';
import { Hono } from 'hono';

interface Identity { readonly subject: unknown; }
const app = new Hono<JwtEnv<Identity>>();
const middleware: MiddlewareHandler<JwtEnv<Identity>> = jwt({
  issuer: 'https://issuer.example', audience: 'https://api.example',
  mapClaims: (claims) => ({ subject: claims.sub }),
});
app.use('/api/*', middleware);
app.get('/api/me', (context) => {
  const identity: Identity = context.var.auth.identity;
  return context.json(identity);
});
const optional = new Hono<JwtEnv<Identity, 'optional'>>();
optional.use(jwt({ issuer: 'https://issuer.example', audience: 'api', mode: 'optional', mapClaims: (claims) => ({ subject: claims.sub }) }));
optional.get('/api/me', (context) => {
  const auth: Auth<Identity> | null = context.var.auth;
  return context.json({ absent: auth === null });
});
void [app, optional];
