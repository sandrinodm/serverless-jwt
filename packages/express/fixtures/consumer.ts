/// <reference types="node" />
import type { RequestHandler } from 'express';
import type { Auth } from '@serverless-jwt/jwt-verifier';
import express from 'express';
import { jwt, getAuth, requireScopes } from '@serverless-jwt/express';
const app = express();
const middleware: RequestHandler = jwt({ issuer: 'https://issuer.example', audience: 'api', mapClaims: () => ({ subject: 'one' }) });
app.use('/api', middleware);
app.get('/api/me', (request, response) => {
  const auth: Auth<{ readonly subject: string }> = getAuth(request);
  // @ts-expect-error global auth cannot claim one factory's identity
  request.auth.identity.subject;
  response.json(auth.identity);
});
app.get('/api/admin', requireScopes(['admin']), (_request, response) => response.end());
