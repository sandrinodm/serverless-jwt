# @serverless-jwt/vercel

[README](../../README.md) · [Getting started](../../docs/getting-started.md) · [Configuration](../../docs/configuration.md) · [Errors](../../docs/errors.md) · [Compatibility](../../docs/compatibility.md)

Bearer access-token authentication for plain Vercel Functions using the Web signature.
Requires Node 24+. Next.js applications on Vercel should use @serverless-jwt/next.

## Install

```sh
pnpm add @serverless-jwt/vercel
pnpm add -D @vercel/functions@3.10.6
```

## Quick start

```ts
import { withJwt } from '@serverless-jwt/vercel';

export const GET = withJwt(
  { issuer: 'https://issuer.example', audience: 'https://api.example' },
  async (request, context, auth) =>
    Response.json({ subject: auth.claims.sub, scopes: auth.scopes }),
);
export const OPTIONS = GET;
```

Construct once at module scope. The original native Web Request and platform context are
forwarded untouched. Auth always occupies the third argument, including when the caller
omits the second argument. The deprecated context is optional and generic; the SDK exports
no public Web-handler context type. The tested CLI supplies an object with waitUntil.
The real native Request also satisfies the SDK's exported request-header helper surface.

## Options and errors

Options accept core verifier configuration or an existing verifier, exclusively, plus mode,
scopes, scopeMode, skip and onIntegrationDiagnostic. Required supplies Auth; optional missing
credentials supply null; explicit synchronous boolean skips permit unauthenticated access
and supply undefined. Invalid credentials reject in optional mode.

onError(error, request, context) may return or resolve a Response, or undefined for the
default. Preserve cache-control: no-store in custom responses. Thrown, rejected, consumed,
locked or unusable custom responses use the default and emit only integration.on_error_failed.
The Web response has not been committed until the function returns. Handler errors propagate
unchanged. Default JSON descriptions never echo token data; missing credentials return 401,
malformed/multiple credentials 400, scope refusal 403, and outages/cancellation 503 plus Retry-After.

## CORS and deployment

OPTIONS reaching the wrapper is authenticated by default. Export a guarded OPTIONS handler,
or deliberately answer actual preflights in middleware before authentication. A skip predicate
explicitly permits unauthenticated access.

The example uses actual Vercel CLI 65.11.0 build output on a local Node server, plus actual
account-free dev --local. Local-only settings and isolated CLI state avoid account linking.
Its private build config supports the CLI's TypeScript 7 transpiler while a separate type
config retains strict isolated declarations. Compiler failures are enforced explicitly.

## Tested local ingress limitation

Vercel CLI 65.11.0 dev --local retains only the first separate Authorization line before
constructing Request. The adapter cannot recover discarded lines; enforce repeated-wire
credential rejection before such ingress if that policy is required. Joined credentials
and duplicate pairs still present in Request always reject with 400. The capability report
records this exact local-host gap; hosted Vercel ingress remains unverified.

See [tested compatibility](../../docs/compatibility.md) and the
[complete example](../../e2e/apps/vercel).

<!-- tested-environments:start -->

## Tested environments

| Area                     | Environment or behavior                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| SDK/host                 | Functions 3.10.6; CLI 65.11.0; Node 24 local build/output                                                                      |
| Forms                    | Named Web handlers; actual account-free local development ingress                                                              |
| Limits                   | Hosted deployment/ingress unverified; Vercel Edge disables cross-request I/O sharing                                           |
| Native development cache | Vercel CLI 65.11.0 starts a fresh function worker for each request. The production Build Output test also covers worker reuse. |

### Local capability matrix

Duplicate results list the HTTP status for two Authorization header orders, valid first and invalid first.

| Form / host                                | Project | Route     | Duplicate results | Measured limits                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | ------- | --------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| vercel-dev / vercel-cli-development (`.`)  | nightly | `/api/me` | 200 / 401         | not enforceable here: native Vercel development ingress retains only the first Authorization wire line not enforceable here: native Vercel dev forks and discards one function worker per request; both 200-request rounds have cold verifier caches, while production Node24 separately proves persistent warm-cache behavior |
| vercel-output / vercel-output-node24 (`.`) | pr      | `/api/me` | 400 / 400         | No measured loss of the tested duplicate-header guarantee.                                                                                                                                                                                                                                                                     |

<!-- tested-environments:end -->
