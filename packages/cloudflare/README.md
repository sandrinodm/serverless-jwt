# @serverless-jwt/cloudflare

[README](../../README.md) · [Getting started](../../docs/getting-started.md) · [Configuration](../../docs/configuration.md) · [Errors](../../docs/errors.md) · [Compatibility](../../docs/compatibility.md)

Bearer access-token authentication for Cloudflare Workers and Pages Functions.
Requires Node 24+ for local consumers; deployed code uses Web APIs only.

## Install

```sh
pnpm add @serverless-jwt/cloudflare
pnpm add -D @cloudflare/workers-types@5.20261104.1
```

## Workers quick start

```ts
import { withJwt } from '@serverless-jwt/cloudflare';

export default {
  fetch: withJwt(
    (env: { ISSUER: string }) => ({ issuer: env.ISSUER, audience: 'https://api.example' }),
    async (request, env, ctx, auth) => Response.json({ subject: auth.claims.sub }),
  ),
};
```

Create the wrapper once at module scope. Prefer a single static configuration read once
from your environment where your deployment supports it. An environment resolver is
synchronous and returns the complete options. Its per-factory LRU retains at most eight
guards and keys every option, including ordered arrays and function identities. Keep
extension functions stable across calls. A changed endpoint, scope, mode, or extension
creates a separate verifier; no process-wide or cross-isolate key registry exists.

## Pages Functions

```ts
// functions/_middleware.ts
import { jwtMiddleware } from '@serverless-jwt/cloudflare';
export const onRequest = jwtMiddleware({
  issuer: 'https://issuer.example',
  audience: 'https://api.example',
});
// functions/api/me.ts
import { getAuth } from '@serverless-jwt/cloudflare';
export const onRequestGet = (context) => Response.json(getAuth(context.data).identity);
```

Auth lives in the extra Workers handler argument or the current Pages `context.data.auth`.
Workers forwards the original request, environment and execution context. Pages preserves
the original context and calls `next()` only after authentication. Pages data has
`Auth<unknown> | null | undefined`; `getAuth<Identity>(data)` checks required auth and
throws the fixed `auth_context_missing` server error on an unguarded path. Choose the
identity type that your own `mapClaims` supplies.

## Options and errors

Options accept the core verifier configuration or `{ verifier }`, exclusively, plus
`mode`, `scopes`, `scopeMode`, `skip`, and `onIntegrationDiagnostic`. Required is
the default; optional missing credentials yield null. Explicit synchronous boolean
`skip` permits unauthenticated requests and yields undefined. Invalid credentials still
reject in optional mode. Arrays are ordered configuration inputs.

Workers `onError(error, request, env, ctx)` and Pages `onError(error, context)` may
return or resolve a Response, or undefined for the default. Keep `cache-control: no-store`
on custom responses. Thrown, rejected, consumed, locked or unusable custom responses use
the default and emit only `integration.on_error_failed`. Downstream application errors
propagate through the platform's normal error path.

Default rejections use fixed JSON descriptions, RFC 6750 challenges and no-store.
Missing credentials reject with 401, malformed/duplicate credentials with 400, insufficient
scope with 403, and key outages/cancellation with 503 and Retry-After.

## CORS and deployment

OPTIONS is authenticated by default. Put a CORS middleware before this guard to answer
actual preflights. A skip predicate deliberately permits unauthenticated requests.

Use `wrangler dev --local` and deploy through your normal Workers/Pages workflow.
Workerd disables cross-request in-flight I/O sharing. Each verifier owns its cache and
bounds concurrent cold key fetches; bursts may receive 503. The native suite separately
proves cold capacity and 200 warmed concurrent identities. Cloudflare's Fetch types differ
from DOM iterator/event declarations under TypeScript 7; only the adapter's erased
boundary bridges those declarations. All consumer checks still use TypeScript 7.

See [tested compatibility](../../docs/compatibility.md) and the complete
[example app](../../e2e/apps/cloudflare).

<!-- tested-environments:start -->

## Tested environments

| Area     | Environment or behavior                                                          |
| -------- | -------------------------------------------------------------------------------- |
| SDK/host | Workers types 5.20261104.1; Wrangler 4.157.0, local workerd 1.20261103.1         |
| Forms    | Workers and Pages Functions; native conformance and local HTTPS issuer           |
| Limits   | Hosted ingress/deployment unverified; independent per-request key I/O on workerd |

### Local capability matrix

Duplicate results list the HTTP status for two Authorization header orders, valid first and invalid first.

| Form / host                        | Project | Route        | Duplicate results | Measured limits                                            |
| ---------------------------------- | ------- | ------------ | ----------------- | ---------------------------------------------------------- |
| cloudflare-workers / workers (`.`) | pr      | `/protected` | 400 / 400         | No measured loss of the tested duplicate-header guarantee. |
| cloudflare-pages / pages (`.`)     | pr      | `/api/me`    | 400 / 400         | No measured loss of the tested duplicate-header guarantee. |

<!-- tested-environments:end -->
