/// <reference types="node" />

import type { Context } from '@netlify/functions';
import type { Auth } from '@serverless-jwt/jwt-verifier';

import { withJwt as functionsJwt } from '@serverless-jwt/netlify';
import { withJwt as edgeJwt } from '@serverless-jwt/netlify/edge';

for (const withJwt of [functionsJwt, edgeJwt]) {
  const route: (request: Request, context: Context) => Promise<Response> = withJwt(
    { issuer: 'https://issuer.example', audience: 'api', mapClaims: () => ({ subject: 'one' }) },
    (request, context, auth) => {
      const identity: Auth<{ subject: string }> = auth;
      // @ts-expect-error mapped identity retains its exact properties
      auth.identity.nonexistent;
      // @ts-expect-error Context retains its actual platform shape
      context.nonexistent;
      return Response.json({ subject: identity.identity.subject, method: request.method });
    },
  );
  void route;
}
