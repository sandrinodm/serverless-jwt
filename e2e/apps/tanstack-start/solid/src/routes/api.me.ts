import { jwtMiddleware } from '@serverless-jwt/tanstack-start';
import { createFileRoute } from '@tanstack/solid-router';
import { createMiddleware } from '@tanstack/solid-start';
import { getRequest } from '@tanstack/solid-start/server';

import { capabilityResponse } from '../../../capabilities.ts';

/**
 * First-party server(...) compilation removes the entire factory policy from client output.
 */
const first = createMiddleware({ type: 'request' }).server(
  jwtMiddleware({
    issuer: process.env.ISSUER ?? 'https://issuer.example',
    audience: 'https://resource.example',
    ...(process.env.JWKS_URI ? { jwksUri: process.env.JWKS_URI } : {}),
    mapClaims: (claims) => ({
      subject: String(claims.sub),
      privatePolicy: 'P4_PRIVATE_POLICY_SOLID',
    }),
  }),
);

/**
 * A second native middleware propagates the mapped identity without serializing auth.
 */
const second = createMiddleware({ type: 'request' })
  .middleware([first])
  .server(({ context, next }) => next({ context: { second: context.auth.identity.subject } }));

/**
 * Two levels of native inference remain concrete inside the actual server route.
 */
const third = createMiddleware({ type: 'request' })
  .middleware([second])
  .server(({ context, next }) => next({ context: { third: context.auth.identity.subject } }));

/**
 * Matched-route middleware protects encoded aliases and all resource methods.
 */
export const Route = createFileRoute('/api/me')({
  server: {
    middleware: [third],
    handlers: {
      GET: ({ context }) =>
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
      POST: ({ context }) =>
        capabilityResponse(
          getRequest(),
          context.auth.identity.subject,
          Response.json({ subject: context.auth.identity.subject, method: getRequest().method }),
        ),
      OPTIONS: ({ context }) =>
        capabilityResponse(
          getRequest(),
          context.auth.identity.subject,
          Response.json({ subject: context.auth.identity.subject, method: getRequest().method }),
        ),
    },
  },
});
