import { createJwtVerifier, type Auth, type JwtVerifierError } from '@serverless-jwt/jwt-verifier';
const verifier = createJwtVerifier({ issuer: 'https://issuer.test', audience: 'api', mapClaims: (claims) => ({ id: claims.sub }) });
const auth: Promise<Auth<{ id: unknown }>> = verifier.verify('a.b.c');
void auth;
const error = null as JwtVerifierError | null;
void error?.toHttp();

import { createGuard, authorizationFromNodeRequest, type Decision } from '@serverless-jwt/jwt-verifier/adapter';
const guard = createGuard({ verifier, mode: 'optional' });
const decision: Promise<Decision<{ id: unknown }, 'optional'>> = guard.decide({ method: 'GET', url: 'https://api.test', authorization: authorizationFromNodeRequest({ rawHeaders: [] }), header: () => undefined });
void decision;
