/// <reference types="node" />
import type { NextApiHandler } from 'next';
import type { Auth } from '@serverless-jwt/jwt-verifier';
import { withJwtPages } from '@serverless-jwt/next/pages';
const options = { issuer: 'https://issuer.example', audience: 'api', mapClaims: () => ({ subject: 'one' }) };
const handler: NextApiHandler = withJwtPages(options, async (request, response, auth) => {
 const typed: Auth<{ subject: string }> = auth;
 response.json({ subject: typed.identity.subject, method: request.method });
});
withJwtPages({ ...options, mode: 'optional' }, (_request, response, auth) => { const typed: Auth<{ subject: string }> | null = auth; response.json(typed); });
withJwtPages({ ...options, skip: () => true }, (_request, response, auth) => { const typed: Auth<{ subject: string }> | undefined = auth; response.json(typed); });
void handler;
