import type { ExportedHandler, PagesFunction } from '@cloudflare/workers-types';
import type { Auth, VerifiedClaims } from '@serverless-jwt/jwt-verifier';

import { getAuth, jwtMiddleware, withJwt } from '@serverless-jwt/cloudflare';

/**
 * An isolated app verifies actual platform assignability and mapped-identity inference.
 */
interface Env { readonly ISSUER: string; }

const fetch = withJwt(
  (env: Env) => ({
    issuer: env.ISSUER, audience: 'api',
    mapClaims: (claims) => ({ subject: claims.sub }),
  }),
  async (_request, env, _context, auth) => {
    const subject: unknown = auth.identity.subject;
    const issuer: string = env.ISSUER;
    return Response.json({ subject, issuer });
  },
);
const worker: ExportedHandler<Env> = { fetch };
const pages: PagesFunction = jwtMiddleware({ issuer: 'https://issuer.example', audience: 'api' });
withJwt({ issuer: 'https://issuer.example', audience: 'api', mode: 'optional' }, (_r, _e, _c, auth) => {
  const checked: Auth<VerifiedClaims> | null = auth;
  return Response.json({ present: checked !== null });
});
withJwt({ issuer: 'https://issuer.example', audience: 'api', skip: () => true }, (_r, _e, _c, auth) => {
  const checked: Auth<VerifiedClaims> | undefined = auth;
  return Response.json({ present: checked !== undefined });
});
const first: Auth<{ readonly user: string }> = getAuth({});
const second: Auth<{ readonly account: number }> = getAuth({});
void [worker, pages, first, second];
