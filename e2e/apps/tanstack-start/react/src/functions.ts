import { jwtFunctionMiddleware } from '@serverless-jwt/tanstack-start';
import { createMiddleware, createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';

import { capabilityResponse } from '../../capabilities.ts';

/**
 * Keep this complete factory/options call inside Start's transformed server(...) argument.
 */
const first = createMiddleware({ type: 'function' }).server(
  jwtFunctionMiddleware({
    issuer: process.env.ISSUER ?? 'https://issuer.example',
    audience: 'https://resource.example',
    ...(process.env.JWKS_URI ? { jwksUri: process.env.JWKS_URI } : {}),
    mapClaims: (claims) => ({ subject: String(claims.sub), privatePolicy: 'P4_PRIVATE_RPC_REACT' }),
  }),
);

/**
 * A second middleware preserves the exact typed server context without sendContext.
 */
const second = createMiddleware({ type: 'function' })
  .middleware([first])
  .server(({ context, next }) => next({ context: { second: context.auth.identity.subject } }));

/**
 * Actual compiled RPC validates identity two middleware levels down.
 */
const third = createMiddleware({ type: 'function' })
  .middleware([second])
  .server(({ context, next }) => next({ context: { third: context.auth.identity.subject } }));

/**
 * A raw Response is a native supported server-function result and preserves HTTP status/headers.
 */
export const protectedRpc = createServerFn({ method: 'GET' })
  .middleware([third])
  .handler(({ context }) =>
    capabilityResponse(
      getRequest(),
      context.auth.identity.subject,
      Response.json({
        subject: context.auth.identity.subject,
        second: context.second,
        third: context.third,
        method: getRequest().method,
      }),
    ),
  );

/**
 * Ordinary serialized RPC also returns only deliberate handler data, never auth/sendContext.
 */
export const serializedRpc = createServerFn({ method: 'GET' })
  .middleware([third])
  .handler(({ context }) => ({
    subject: context.auth.identity.subject,
    second: context.second,
    third: context.third,
    method: getRequest().method,
  }));
