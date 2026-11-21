/// <reference types="node" />
import type { Handler, HandlerContext } from '@netlify/functions';
import type { Auth } from '@serverless-jwt/jwt-verifier';
import { withJwt } from '@serverless-jwt/netlify/v1';
const options = { issuer: 'https://issuer.example', audience: 'api', mapClaims: () => ({ subject: 'one' }) };
const handler: Handler = withJwt(options, async (event, context, auth) => {
 const identity: Auth<{ subject: string }> = auth;
 const original: HandlerContext = context;
 return { statusCode: 200, body: JSON.stringify({ subject: identity.identity.subject, path: event.path, original: original.functionName }) };
});
withJwt({ ...options, mode: 'optional' }, async (_event, _context, auth) => { const typed: Auth<{ subject: string }> | null = auth; return { statusCode: 200, body: JSON.stringify(typed) }; });
withJwt({ ...options, skip: () => true }, async (_event, _context, auth) => { const typed: Auth<{ subject: string }> | undefined = auth; return { statusCode: 200, body: JSON.stringify(typed) }; });
// @ts-expect-error callback handlers are unsupported
withJwt(options, () => ({ statusCode: 200 }));
void handler;
