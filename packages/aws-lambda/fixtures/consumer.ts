/// <reference types="node" />
import type { APIGatewayProxyHandler, APIGatewayProxyHandlerV2, ALBHandler, Context } from 'aws-lambda';
import type { Auth } from '@serverless-jwt/jwt-verifier';
import { withJwt } from '@serverless-jwt/aws-lambda';
const options = { issuer: 'https://issuer.example', audience: 'api', mapClaims: () => ({ subject: 'one' }) };
const v1: APIGatewayProxyHandler = withJwt.apiGatewayV1(options, async (event, context, auth) => {
  const identity: Auth<{ subject: string }> = auth;
  const original: Context = context;
  return { statusCode: 200, body: JSON.stringify({ subject: identity.identity.subject, path: event.path, original: original.awsRequestId }) };
});
const v2: APIGatewayProxyHandlerV2 = withJwt.apiGatewayV2(options, async (_event, _context, auth) => ({ statusCode: 200, body: auth.identity.subject }));
const alb: ALBHandler = withJwt.alb(options, async (_event, _context, auth) => ({ statusCode: 200, body: auth.identity.subject }));
withJwt.apiGatewayV1({ ...options, mode: 'optional' }, async (_event, _context, auth) => {
  const optional: Auth<{ subject: string }> | null = auth;
  // @ts-expect-error optional missing credentials are null
  auth.identity.subject;
  return { statusCode: 200, body: String(optional === null) };
});
withJwt.apiGatewayV2({ ...options, skip: () => true }, async (_event, _context, auth) => {
  const skipped: Auth<{ subject: string }> | undefined = auth;
  // @ts-expect-error explicit skip is undefined
  auth.identity.subject;
  return { statusCode: 200, body: String(skipped === undefined) };
});
// @ts-expect-error downstream handlers must return a promise
withJwt.apiGatewayV1(options, () => ({ statusCode: 200, body: '' }));
void [v1, v2, alb];
