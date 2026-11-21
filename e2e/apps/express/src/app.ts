import { jwt, getAuth } from '@serverless-jwt/express';
import express from 'express';

import { nodeCors, nodeStream } from '../capabilities.ts';

/**
 * Module-scope configuration creates one isolated verifier per application instance.
 */
const app = express();
app.get('/ready', (_request, response) => response.end('ready'));
app.use((request, response, next): void => {
  if (!nodeCors(request, response)) {
    next();
  }
});
app.use(
  '/protected',
  jwt({
    issuer: process.env.ISSUER ?? 'https://issuer.example',
    audience: 'https://resource.example',
    ...(process.env.JWKS_URI ? { jwksUri: process.env.JWKS_URI } : {}),
  }),
);
app.all('/protected', (request, response): void => {
  if (!nodeStream(request, response, getAuth(request).claims.sub)) {
    response.json({ sub: getAuth(request).claims.sub, scopes: getAuth(request).scopes });
  }
});
app.listen(Number(process.env.PORT), '127.0.0.1');
