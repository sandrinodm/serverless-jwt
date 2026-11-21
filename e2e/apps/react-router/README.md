# React Router example

This private application uses React Router 8.5.1 with actual production build and
react-router-serve. The route module exports middleware for both its loader and action;
its auth context is application-owned and typed. No future middleware flag is needed.

Run `pnpm --filter @serverless-jwt/react-router... build`, then
`pnpm --dir e2e/apps/react-router build:app`. The build invokes real framework compilation,
native route type generation and mandatory TypeScript 7 checks. The generated route's
actual MiddlewareFunction and LoaderArgs types are checked without invented platform shapes.

Supply ISSUER and optionally JWKS_URI when starting `react-router-serve build/server/index.js`.
The test harness supplies a verified local HTTPS issuer and isolated native process. It checks
two rounds of 200 distinct identities, original method through GET/POST/OPTIONS, forged
preflight refusal, encoded routes, comma rejection, both duplicate wire orders, invalid
audience and cold key outage. `/ready` is a fixed public readiness resource.

The tested native ingress discards later separate Authorization lines, so valid-first
returns 200 and invalid-first returns 401. Comma-joined values remain rejected. This is
an explicit transport limitation; mandatory authentication cases remain enforced.
Browser page navigation does not supply bearer headers; use these resource APIs from
callers that deliberately attach access tokens.
