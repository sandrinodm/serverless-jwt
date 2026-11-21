# @serverless-jwt/netlify

[README](../../README.md) · [Getting started](../../docs/getting-started.md) · [Configuration](../../docs/configuration.md) · [Errors](../../docs/errors.md) · [Compatibility](../../docs/compatibility.md)

Bearer access-token authentication for Netlify Functions v2 and Edge Functions.

## Install

```sh
pnpm add @serverless-jwt/netlify
pnpm add -D @netlify/functions@6.1.0 @netlify/edge-functions@4.0.3 @types/node@26.6.6
```

## Quick start

```ts
import { withJwt } from '@serverless-jwt/netlify';

export default withJwt(
  { issuer: 'https://issuer.example', audience: 'https://api.example' },
  async (request, context, auth) =>
    Response.json({ subject: auth.claims.sub, scopes: auth.scopes }),
);
```

Functions projects include Node ambient types required by the real SDK declarations.
Edge declarations are checked independently without Node ambient types.

For Edge, import the same factory from @serverless-jwt/netlify/edge. Construct it once
at module scope. Request and the real typed platform Context pass through untouched;
auth always occupies the third argument. The Edge runtime graph has no Node imports.
This integration verifies bearer access tokens independently of Netlify Identity. Lambda-compatible Functions v1 uses the dedicated Node entry.

## Options and errors

Options accept core verifier configuration or an existing verifier, exclusively, plus mode,
scopes, scopeMode, skip and onIntegrationDiagnostic. Required supplies Auth; optional missing
credentials supply null; explicit synchronous boolean skips permit unauthenticated access
and supply undefined. Invalid credentials reject in optional mode.

onError(error, request, context) may return or resolve a Response, or undefined for the
default. Preserve cache-control: no-store in custom responses. Thrown, rejected, consumed,
locked or unusable custom responses use the default and emit only integration.on_error_failed.
The response has not been committed until the function returns. Handler errors propagate
unchanged. Missing credentials return 401, malformed/multiple credentials 400, scope
refusal 403, and outages/cancellation 503 plus Retry-After. Errors never echo token data.

## CORS and deployment

OPTIONS reaching the wrapper is authenticated by default. Deliberately answer actual
preflights before authentication when required. A skip predicate explicitly permits
unauthenticated access. The wrapper does not add Netlify cache or edge bypass declarations;
a protected deployment must route all methods through the guarded function.

The complete example uses actual Netlify CLI 27.16.2 build --offline and dev --offline
without an account. Both Functions v2 and Deno Edge authenticate against verified HTTPS
issuers. The site is copied into an isolated directory so ancestor monorepo lockfiles do
not change the CLI's base paths. Edge receives its fixture CA through temporary .env,
with no TLS bypass.

## Tested local ingress limitation

Both actual offline CLI paths discard later separate Authorization lines. A valid first
line followed by an invalid line returns 200; reversing them returns 401. The adapter
cannot recover discarded wire lines. Enforce repeated-wire rejection before such ingress
if that policy is required. Joined credentials and duplicate pairs still present in native
Request reject with 400. Hosted Netlify ingress remains unverified.

An ordinary installed tarball consumer passes strict Deno declaration checking, including
negative identity/context assertions, and a separate runtime graph check rejects Node imports.
Workspace file:// declaration traversal requires the explicit source condition; published
npm consumers use their normal package resolution. See [compatibility](../../docs/compatibility.md). See the [complete example](../../e2e/apps/netlify).

## Transitional Functions v1

`import { withJwt } from '@serverless-jwt/netlify/v1'` wraps the Lambda-compatible `(event, context)` shape with a promise-only `(event, context, auth)` callback. It is deprecated from 1.0: Netlify Lambda compatibility deployments stop on **2027-07-01**, and this entry is removed in 2.0. Prefer the root Functions v2 entry.

```ts
import { withJwt } from '@serverless-jwt/netlify/v1';
export const handler = withJwt(
  { issuer: 'https://issuer.example', audience: 'api' },
  async (event, context, auth) => ({ statusCode: 200, body: JSON.stringify(auth.identity) }),
);
```

Read the verified identity from the third argument’s `auth.identity`. Netlify retains ownership of `context.clientContext`. API Gateway v1 extraction preserves authoritative `multiValueHeaders`. Callback-style handlers and response streaming are unsupported. `onError(error, event, context)` returns a matching Lambda result or undefined.

The native invocation context has no AbortSignal. Callers can provide synchronous `getSignal(event, context): AbortSignal | undefined` for per-invocation cancellation. Thrown callbacks, async callbacks and invalid values fail closed with fixed `adapter_misconfigured`, with rejected thenables observed. The existing default verification timeout remains active without a supplied signal.

<!-- tested-environments:start -->

## Tested environments

| Area     | Environment or behavior                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------- |
| SDK/host | Functions 6.1.0; Edge Functions 4.0.3; CLI 27.16.2 offline                                              |
| Forms    | Functions v2, Deno Edge and transitional Lambda-compatible v1                                           |
| Limits   | Hosted deployment unverified; local CLI can discard repeated wire Authorization lines; v1 is deprecated |

### Local capability matrix

Duplicate results list the HTTP status for two Authorization header orders, valid first and invalid first.

| Form / host                                 | Project | Route                    | Duplicate results | Measured limits                                                                                                        |
| ------------------------------------------- | ------- | ------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| netlify-v1 / node24-recorded-event (`./v1`) | pr      | `/protected`             | 400 / 400         | Event-result API: no incremental HTTP body.                                                                            |
| netlify-v2 / netlify-offline (`.`)          | pr      | `/.netlify/functions/me` | 200 / 401         | not enforceable here: Netlify Functions local ingress discards later Authorization lines                               |
| netlify-edge / netlify-deno-edge (`./edge`) | pr      | `/edge/me`               | 200 / 401         | not enforceable here: Netlify local proxy discards later raw Authorization lines before Deno Edge receives the Request |

<!-- tested-environments:end -->
