import type { Request as VercelRequestHeaders } from '@vercel/functions/headers';
import type { Auth, VerifiedClaims } from '@serverless-jwt/jwt-verifier';

import { withJwt } from '@serverless-jwt/vercel';

const GET = withJwt({
  issuer: 'https://issuer.example', audience: 'https://api.example',
  mapClaims: (claims) => ({ subject: claims.sub }),
}, (request, context: { readonly waitUntil: (promise: Promise<unknown>) => void } | undefined, auth) => {
  const headers: VercelRequestHeaders = request;
  const subject: unknown = auth.identity.subject;
  return Response.json({ subject, context: context !== undefined, headers: headers.headers.get('x-probe') });
});
const native: (request: Request, context?: { readonly waitUntil: (promise: Promise<unknown>) => void }) => Promise<Response> = GET;
withJwt({ issuer: 'https://issuer.example', audience: 'api', mode: 'optional' }, (_r, _c, auth) => {
  const checked: Auth<VerifiedClaims> | null = auth;
  return Response.json({ absent: checked === null });
});
withJwt({ issuer: 'https://issuer.example', audience: 'api', skip: (request) => request.method === 'OPTIONS' }, (_r, _c, auth) => Response.json({ skipped: auth === undefined }));
void native;
