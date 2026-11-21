# @serverless-jwt/hono

[README](../../README.md) · [Getting started](../../docs/getting-started.md) · [Configuration](../../docs/configuration.md) · [Errors](../../docs/errors.md) · [Compatibility](../../docs/compatibility.md)

Bearer access-token middleware for Hono 4.13.16 on Node, Bun, Deno and workerd.
Published libraries support Node24+; the runtime uses Web APIs.

## Install

```sh
pnpm add @serverless-jwt/hono hono@4.13.16
```

## Quick start

```ts
import { jwt, type JwtEnv } from '@serverless-jwt/hono';
import { Hono } from 'hono';

type Identity = { subject: unknown };
const app = new Hono<JwtEnv<Identity>>();
app.use(
  '/api/*',
  jwt({
    issuer: 'https://issuer.example',
    audience: 'https://api.example',
    mapClaims: (claims) => ({ subject: claims.sub }),
  }),
);
app.get('/api/me', (c) => c.json(c.var.auth.identity));
export default app;
```

Create middleware once at module scope. Hono owns the original native request and context;
auth lives only in that request's c.var.auth. Read auth on routes covered by the middleware.
Unguarded routes have no auth. Use matching JwtEnv identity/mode/skip generics for the
app's guarded routes; optional mode includes null and explicit skips include undefined.

## Options and errors

Options accept core verifier configuration or an existing verifier, exclusively, plus
mode, scopes, scopeMode, skip and onIntegrationDiagnostic. Required is the default.
Optional missing credentials yield null; invalid credentials still reject. A synchronous
boolean skip deliberately permits unauthenticated requests with auth undefined.

onError(error, context) may return or resolve a Response, or undefined for the default.
The hook's context makes absent auth explicit. Keep cache-control: no-store on custom
responses. Thrown, rejected, consumed, locked or unusable results emit only the fixed
integration.on_error_failed diagnostic and use the default before finalization.
An already finalized Hono response is preserved; the middleware never writes a second body.
Downstream next() is outside authentication catches, preserving Hono's normal error path.

Defaults use fixed JSON descriptions and no-store: missing credentials: 401,
malformed/multiple credentials: 400, insufficient scopes: 403, outages/cancellation: 503
with Retry-After.

## CORS and deployment

OPTIONS is authenticated by default. Install Hono CORS middleware before jwt to answer
actual preflights. An explicit skip permits unauthenticated access.

The complete app runs on actual @hono/node-server, Bun.serve, Deno.serve and Wrangler
workerd. All use the same built Hono application and verified HTTPS issuer. Workerd
disables cross-request fetch sharing and bounds cold concurrency; the identity contract
warms its cache before the concurrent burst.

## Compared with hono/jwk

Hono also ships hono/jwt and hono/jwk. This package adds issuer discovery, explicit
bounded key-cache/outage policy, fixed RFC 6750 error/challenge responses and scope checks.
It verifies resource-server access tokens and does not create sessions or browser cookies.

See [tested compatibility](../../docs/compatibility.md) and the
[complete cross-runtime app](../../e2e/apps/hono).

<!-- tested-environments:start -->

## Tested environments

| Area      | Environment or behavior                                                   |
| --------- | ------------------------------------------------------------------------- |
| Framework | Hono 4.13.16; @hono/node-server 2.1.6                                     |
| Hosts     | Node, Bun 1.4.4, Deno 2.9.6 and Wrangler 4.157.0/workerd                  |
| Coverage  | Native conformance, strict packed types and local real-issuer HTTP checks |

### Local capability matrix

Duplicate results list the HTTP status for two Authorization header orders, valid first and invalid first.

| Form / host                  | Project | Route     | Duplicate results | Measured limits                                            |
| ---------------------------- | ------- | --------- | ----------------- | ---------------------------------------------------------- |
| hono-node / node (`.`)       | pr      | `/api/me` | 400 / 400         | No measured loss of the tested duplicate-header guarantee. |
| hono-bun / bun (`.`)         | pr      | `/api/me` | 400 / 400         | No measured loss of the tested duplicate-header guarantee. |
| hono-deno / deno (`.`)       | pr      | `/api/me` | 400 / 400         | No measured loss of the tested duplicate-header guarantee. |
| hono-workerd / workerd (`.`) | pr      | `/api/me` | 400 / 400         | No measured loss of the tested duplicate-header guarantee. |

<!-- tested-environments:end -->
