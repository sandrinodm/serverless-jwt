# @serverless-jwt/tanstack-start

[README](../../README.md) · [Getting started](../../docs/getting-started.md) · [Configuration](../../docs/configuration.md) · [Errors](../../docs/errors.md) · [Compatibility](../../docs/compatibility.md)

Compiler-safe bearer middleware callbacks for React Start and Solid Start 1.169.4.
Published packages support Node 24+. Both frameworks use the same verified official
middleware and request-accessor implementations.

## Install

```sh
pnpm add @serverless-jwt/tanstack-start @tanstack/react-start@1.169.4 \
  @tanstack/start-client-core@1.170.39 @tanstack/start-server-core@1.169.45
```

Use @tanstack/solid-start 1.169.4 instead for Solid. The two official shared core packages
are explicit framework peers, ensuring the factory and actual host resolve the same request
scope. The tested optional declaration peers are @types/node 26.6.6 and @types/react /
@types/react-dom 19.3.0. The JWT package's only runtime dependency is the portable core.

## Quick start

```ts
import { jwtMiddleware, jwtFunctionMiddleware } from '@serverless-jwt/tanstack-start';
import { createMiddleware } from '@tanstack/react-start';

const requestAuth = createMiddleware({ type: 'request' }).server(
  jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'https://api.example',
    mapClaims: (claims) => ({ subject: String(claims.sub) }),
  }),
);
const functionAuth = createMiddleware({ type: 'function' }).server(
  jwtFunctionMiddleware({
    issuer: 'https://issuer.example',
    audience: 'https://api.example',
    mapClaims: (claims) => ({ subject: String(claims.sub) }),
  }),
);
```

Create each factory once at module scope **inside the first-party `.server(...)` argument**.
These factories return the framework's real server callbacks. Keep the complete options
expression there so Start's compiler removes the factory, verifier and private policy from
browser output. A dependency factory returning prebuilt middleware bypasses that first-party
transform and can expose its options to the browser. Do not move these calls outside
`.server(...)` or hide that call behind another helper.

Attach requestAuth to the native server route's `server.middleware` list. Attach functionAuth
to `createServerFn(...).middleware([functionAuth])`. Solid uses the identical composition
through @tanstack/solid-start. Native context.auth retains the mapped identity through two
further middleware levels; auth is passed only through server context, never sendContext.
No global auth declaration is added. Request middleware is attached by matched route,
protecting encoded aliases without custom raw-prefix policy checks.

## Options and errors

Options accept core verifier configuration or an existing verifier, exclusively, plus mode,
scopes, scopeMode, skip and onIntegrationDiagnostic. Required is the default. Optional missing
credentials produce null; invalid credentials still reject. Explicit synchronous boolean
skip permits access with undefined auth. Context types reflect only enabled states.

onError(error, request) receives the original native Request and may return or await a
Response, or undefined for the default. Preserve no-store on custom responses. Thrown,
rejected, consumed, locked or unusable hook results emit only the fixed
integration.on_error_failed diagnostic and use the default before downstream code runs.
Downstream next() remains outside authentication catches.

Request callbacks return rejection responses. Function callbacks throw them because Start's
function middleware requires returning the result of next(). Native RPC preserves the exact
HTTP status/body/challenge and Retry-After, plus its own transport headers. Default errors
are missing 401, malformed/multiple 400, scope 403 and outage/cancellation 503 with Retry-After.
Every default error response has no-store and the appropriate RFC 6750 challenge.

## Compiler, CSRF and deployment

For the verified Nitro 3.0.261103-rc Node server preset, configure:

```ts
nitro({ preset: 'node-server', features: { fastResponse: false } });
```

Nitro's default FastResponse loses a copied RPC Response's status after header/body access.
Both factories check this actual Response behavior at construction and on each request,
throwing a fixed ConfigurationError if the runtime installs an incompatible replacement.
This fails closed even if replacement happens after factory creation. No dependency patch
or global Response mutation is performed by this library.

The tested apps retain default Start initialization and its automatic CSRF middleware.
If adding a custom src/start.ts, retain the framework's native CSRF middleware for server
functions. Bearer verification does not replace that protection. OPTIONS is authenticated
for resource routes by default; select deliberate CORS handling or an explicit skip policy.
Native RPC method validation may reject unsupported methods before function middleware.

The complete React/Solid apps compile real RPC client stubs and scan every fresh browser
artifact for private policy and server imports. Real HTTP tests cover both raw Response and
ordinary serialized RPC, proving auth/token context is not serialized. Both separate
Authorization wire orders and native comma values reject with 400 in the verified Nitro
host. Hosted transports remain unverified.

## Compared with framework middleware

Start supplies typed middleware, server functions and CSRF support. This package adds issuer
discovery, bounded key caching/outage policy, scope checks and fixed bearer errors. It verifies
resource-server access tokens and does not issue tokens or create browser sessions.

See [the complete apps](../../e2e/apps/tanstack-start/README.md),
[compatibility](../../docs/compatibility.md) and [integration authoring](../../docs/integration-author.md).

<!-- tested-environments:start -->

## Tested environments

| Area         | Environment or behavior                                                           |
| ------------ | --------------------------------------------------------------------------------- |
| Framework    | React Start and Solid Start 1.169.4                                               |
| Shared cores | client-core 1.170.39; server-core 1.169.45; Nitro 3.0.261103-rc                   |
| Forms        | Native request/function middleware, compiled RPC and production React/Solid hosts |

### Local capability matrix

Duplicate results list the HTTP status for two Authorization header orders, valid first and invalid first.

| Form / host                                            | Project | Route                         | Duplicate results | Measured limits                                                                                                                                                |
| ------------------------------------------------------ | ------- | ----------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tanstack-start-react-request / react-nitro-node (`.`)  | pr      | `/api/me`                     | 400 / 400         | No measured loss of the tested duplicate-header guarantee.                                                                                                     |
| tanstack-start-react-function / react-nitro-node (`.`) | pr      | `runtime-discovered-function` | 400 / 400         | Native GET-only server function rejects OPTIONS before function middleware and handler dispatch; request middleware still requires authentication for OPTIONS. |
| tanstack-start-solid-request / solid-nitro-node (`.`)  | pr      | `/api/me`                     | 400 / 400         | No measured loss of the tested duplicate-header guarantee.                                                                                                     |
| tanstack-start-solid-function / solid-nitro-node (`.`) | pr      | `runtime-discovered-function` | 400 / 400         | Native GET-only server function rejects OPTIONS before function middleware and handler dispatch; request middleware still requires authentication for OPTIONS. |

<!-- tested-environments:end -->
