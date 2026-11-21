# @serverless-jwt/jwt-verifier

[README](../../README.md) · [Getting started](../../docs/getting-started.md) · [Configuration](../../docs/configuration.md) · [Errors](../../docs/errors.md) · [Compatibility](../../docs/compatibility.md)

Portable OAuth access-token verification using Web Crypto and `jose`. ESM only, with Node 24.0.0+, Cloudflare workerd, Deno and Bun coverage. Node 24 can also `require()` the packed ESM package.

```ts
import { createJwtVerifier, getBearerToken, requireScopes } from '@serverless-jwt/jwt-verifier';

const verifier = createJwtVerifier({
  issuer: 'https://issuer.example/',
  audience: 'https://api.example/',
  mapClaims: (claims) => ({ subject: claims.sub }),
});

const bearer = getBearerToken(request.headers.get('authorization'));
if (bearer.ok) {
  const auth = await verifier.verify(bearer.token, { signal: request.signal });
  requireScopes(auth, ['read:items']);
  // auth.identity is inferred from mapClaims; auth.claims always remains the verified payload.
}
```

Create one verifier outside your handler to reuse its cache. `warmup()` fetches discovery and keys ahead of the first request. Each verifier owns its own state; there is no global registry or external key-cache contract.

## Trust and profiles

Configure the issuer exactly, including its trailing slash, and use an **API audience**. The default `generic` profile works with providers that issue `typ: JWT`. An ID token issued to a different client audience is rejected. Reusing a client ID as your API audience can admit ID tokens; a one-time diagnostic warns when a verified `azp` or `client_id` equals a configured audience. That warning does not reject the token.

Use `profile: 'rfc9068'` when your provider issues access tokens with `typ: at+jwt` (case insensitive, optional `application/` prefix). This profile additionally requires `exp`, `iat`, `sub`, `client_id` and `jti` with the specified NumericDate/string types. It cannot disable expiration. Both profiles verify issuer, audience and signature. Only asymmetric signatures are accepted: RS256/384/512, PS256/384/512, ES256/384/512, EdDSA and Ed25519. The default is RS256; RSA requires at least 2048 bits. HS algorithms, `none` and encrypted tokens are unsupported.

Discovery defaults to OIDC. `discovery: 'oauth'` uses RFC 8414 path insertion. A direct `jwksUri` disables discovery and permits an opaque non-URL issuer. Network URLs require HTTPS, no credentials and no fragment. `allowInsecureLocalhost: true` allows HTTP only for localhost, 127.0.0.1 and [::1]. Discovery must advertise exactly the configured issuer; its HTTPS `jwks_uri` may legitimately use another origin.

## Limits and key lifecycle

All durations below are seconds.

| Option                      | Default                                      |
| --------------------------- | -------------------------------------------- |
| `verifyTimeout`             | 10, range 1–60                               |
| `clockTolerance`            | 5, range 0–300                               |
| `maxTokenLength`            | 8192, range 512–65536 characters             |
| `requireExp`                | true; generic may explicitly opt out         |
| `requiredClaims`            | empty; merged with profile requirements      |
| `maxTokenAge`               | unset; when set requires `iat`, 1–31536000   |
| `minRsaModulusLength`       | 2048                                         |
| `keys.cacheMaxAge`          | 600                                          |
| `keys.cooldown`             | 30 between unknown-key refresh attempts      |
| `keys.timeout`              | 5 for headers and the complete streamed body |
| `keys.maxResponseBytes`     | 524288; discovery is always 65536            |
| `keys.maxKeys`              | 100                                          |
| `keys.staleIfError`         | 0, maximum 86400                             |
| `keys.maxConcurrentFetches` | 4 in runtimes without shared request I/O     |

A fetch failure triggers full-jitter exponential backoff, starting at one second and capped at 30 seconds. Failure never refreshes a cache timestamp. By default an expired cache fails closed with 503 during an outage. Opting into `staleIfError` lets a removed or compromised key remain valid for that additional window and emits a diagnostic on every stale use.

Unknown-key refresh reservations happen before I/O, so an attacker cannot cause more than one attempt per cooldown. Expired-cache refresh ignores that cooldown. A successful refresh replaces the entire set. Unsupported, private, weak or malformed entries are individually skipped and reported. A structurally valid JWKS with no usable keys clears the cache of previous keys and reports `jwks_invalid` (503), even with `staleIfError` enabled. Duplicate eligible matching keys also fail as `jwks_invalid`. An x5c-only RSA/EC entry carries its public key through a certificate. HTTPS issuer trust is the authority for those keys. The verifier imports the certificate's public key without validating its chain.

Discovery caches for 24 hours and uses the same sharing and failure ownership policy. A changed URI creates a fresh store and drops old keys. Node, Deno and Bun share in-flight I/O; workerd and Vercel Edge own separate request I/O, bound by `maxConcurrentFetches`. `shareInflight` overrides detection. Slower older responses cannot overwrite newer generations.

Redirects are never followed. Node/Deno/Bun request `redirect: 'error'`. Workerd rejects that Fetch option, so detected edge runtimes request `manual` and reject the 3xx response explicitly. Requests always omit credentials. Custom `fetch` receives an AbortSignal, and an abort-ignoring implementation is still deadline bounded.

## Claims, scopes and extension points

`Auth` contains the original `token`, deeply frozen null-prototype `claims`, separate `identity`, and a frozen deduplicated `scopes` array. Pollution keys `__proto__`, `constructor` and `prototype` are dropped recursively. Duplicate JSON members use the last signed member, matching jose and RFC 7515's permitted parsing behavior.

`mapClaims` receives verified claims. Its result must be a non-null object and may be asynchronous. Mapping failure becomes the fixed `mapping_failed` error. Scope checks always use signed claims: `scope` takes precedence over `scp`, with a diagnostic when both are present. `scope` must be a string. `scp` accepts Entra's space-separated string and providers' string-array form. Invalid tokens are dropped and invalid types yield no scopes, with redacted diagnostics. `hasScopes` and `requireScopes` accept `all` (default) or `any`; an empty required list is a configuration error.

`claimToArray` splits strings on single spaces, returns string arrays and otherwise returns `[]`. `removeNamespaces(claims, prefix)` strips a leading namespace into a null-prototype object. Collisions throw `ConfigurationError` with reason `namespace_collision`; when called inside `mapClaims`, this becomes `mapping_failed`.

`onDiagnostic` receives typed events without token or claim contents. Callbacks run synchronously inside a catch boundary; returned thenable rejections are observed and never awaited. Key identifiers are printable ASCII, capped at 64 characters or SHA-256 hashed. URLs come from trusted configuration/discovery. The library never logs.

One total deadline covers discovery, keys, cryptography and asynchronous mapping. A caller's signal rejects only its own verification and does not cancel another caller's shared fetch. A synchronous callback that never returns cannot be interrupted by a JavaScript timer.

## Errors

Construction throws `ConfigurationError` for invalid options. `verify` rejects with `JwtVerifierError`: fixed `message`, safe `reason`, public `code`, `status` and a non-enumerable `cause`. Avoid serializing causes yourself. `toJSON()` and `toHttp()` contain only the fixed public code/description. `toHttp()` supplies JSON content type, `cache-control: no-store` and the applicable challenge/retry headers. `realm` defaults to `api`, rejects controls and escapes quoted-string characters.

| Public code               | Status                     |
| ------------------------- | -------------------------- |
| `missing_token`           | 401, bare Bearer challenge |
| `invalid_request`         | 400                        |
| `invalid_token`           | 401                        |
| `insufficient_scope`      | 403                        |
| `temporarily_unavailable` | 503, Retry-After           |
| `server_error`            | 500                        |

Missing credentials differ from invalid credentials. Discovery/key outages and verification deadlines return 503 so clients can retry without discarding valid tokens. Application mapping failures return 500. Each integration provides its own adapter and request-context helpers.

See the [API report](../../api/jwt-verifier.api.md), [threat model](../../docs/security/threat-model.md) and [development guide](../../docs/development.md).

## For integration authors

The [`./adapter` API report](../../api/jwt-verifier-adapter.api.md) and
[integration-author guide](../../docs/integration-author.md) document `createGuard`, the
Fetch/Node/Lambda credential extractors and safe response serialization. The subpath is for
official integration authors. It shares core error classes and adds no cost to a root-only
consumer bundle. No request, including a forged CORS preflight, skips authentication by default.

<!-- tested-environments:start -->

## Tested environments

| Area              | Environment or behavior                                            |
| ----------------- | ------------------------------------------------------------------ |
| Node              | 24.0.0 and 26.12.1; exact-tarball ESM/require and strict consumers |
| Portable runtimes | Deno 2.9.6, Bun 1.4.4 and workerd                                  |

<!-- tested-environments:end -->
