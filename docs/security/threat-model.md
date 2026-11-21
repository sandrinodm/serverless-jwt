# Threat model

[README](../../README.md) · [Configuration](../configuration.md) · [Keys and outages](../keys-and-outages.md)

The protected asset is a resource server's authorization decision. The issuer, configured API audience, algorithm allowlist, custom fetch and mapping callbacks are trusted application policy. Bearer credentials, JWT headers/payloads and fetched document contents are untrusted until their respective validation steps finish. This model includes the portable verifier and official integration authentication boundaries.

## Issuer trust

Discovery requires HTTPS by default, exact issuer identity, and a credential-free, fragment-free HTTPS JWKS URL. Cross-origin HTTPS JWKS is normal. Redirects never follow; workerd's unsupported `redirect: error` uses a tested `manual`/reject-3xx equivalent. Only an explicit loopback option permits local HTTP. An opaque issuer requires an explicit trusted JWKS endpoint.

Discovery does not establish that an arbitrary configured hostname is safe: the application chooses its trust root and its network egress policy. No token header (`jku`, `x5u`, embedded `jwk`) controls a network destination. Allowed algorithms are checked before any I/O. An issuer's x5c certificate only transports its public key; this library does not validate a certificate chain or use it as a separate trust anchor.

The generic profile relies on the API audience to separate access tokens from client ID tokens. An API accepting its client ID as audience can accept same-audience ID tokens; a diagnostic is advisory. RFC 9068 mode adds an access-token type discriminator and required typed claims. Symmetric keys and unsecured tokens never verify.

## Key lifecycle and outages

Each verifier owns its store; policies never share a global cache. Fresh keys last ten minutes by default. Refreshes replace the complete set, removing retired keys. Unknown kids reserve a refresh before I/O and obey an attempt-based cooldown. Expired-key refresh ignores that cooldown. Generation order prevents slow older responses and discovery lookups from restoring older material.

Shared in-flight promises are used only where the runtime supports cross-request I/O sharing. Edge cold requests may fetch independently within an isolate semaphore; unknown-key refresh has a single owner. Every failed promise is observed, sharing state is cleared after settlement, and discovery/JWKS recover after backoff.

Outages fail closed. A failed fetch never updates freshness. During backoff only a still-fresh cache or an explicitly bounded stale window can serve. Stale serving is off by default. Enabling it deliberately permits removed or compromised keys to survive for that additional interval; each stale use emits a diagnostic. A random-kid flood cannot create an unbounded fetch queue or monopolize a later expiry refresh.

## Verification and claim mapping

Compact shape, byte-independent character limits, allowed algorithm, critical extensions and NumericDate shape are checked before key lookup. Signature, exact issuer, audience, expiration, not-before and configured age/required claims are checked by jose. Issued-at is additionally bounded against future time. NumericDates must be finite safe integers within the millisecond conversion bound before jose sees them.

Signed JSON duplicate members use the last member, matching jose's JSON parser and RFC 7515 §5.2. The issuer signed all bytes; callers must not independently reinterpret the payload with a different duplicate-member policy. Safe copies retain that interpretation, remove pollution names, create null-prototype objects and freeze every nested JSON value.

Claim mapping receives immutable verified claims and writes only `identity`. The result must be an object. Scope authorization reads the original signed claims, with scope/scp precedence and invalid-value diagnostics; mapped privileges cannot replace signed scope. Namespace stripping fails on collisions in either order rather than overwriting an authorization claim.

## Disclosure and extension boundaries

Messages and HTTP descriptions come from a fixed reason table. Causes are non-enumerable and excluded from every library serializer. Diagnostics carry fixed event types and safe internal reasons; token/claim contents are never logged. JWK identifiers are sanitized/hashed. Endpoint URLs are trusted configuration/discovery data and may appear in private diagnostics.

Applications must protect tokens retained in Auth for delegation and avoid logging causes or whole Auth objects. The library cannot control downstream logging. Synchronous and asynchronous diagnostic failures are isolated. Mapper failures become a fixed 500 rather than reflecting thrown values.

## Resource limits

One total verify deadline covers all awaited work, including a fetch or mapper that ignores cancellation. Caller cancellation does not abort shared operations used by other requests. Each fetch also has a complete header/body timeout, streams bytes through a hard limit, omits credentials and refuses redirects. JWKS key counts, RSA strength and token length bound parsing/import work.

Timers cannot interrupt a synchronous extension point that never yields. Expensive valid-token floods still consume cryptographic CPU; deployments need platform-level request/concurrency controls. Full jitter backoff bounds retry pressure but is not an application rate limiter. JSON byte limits bound document size; the threat model does not promise unlimited nesting handling outside those finite input bounds.

## Integration authentication boundaries

Each integration extracts every credential value available from its platform boundary. Duplicate or malformed credentials reject rather than selecting a convenient value. Required mode rejects missing credentials; optional mode permits only genuinely absent credentials. Skip and protect policies deliberately establish which routes can remain unauthenticated; configuration and registration failures must fail closed. Encoded-path normalization and framework static output are part of that boundary, as documented by the relevant integration.

Authentication stays request-owned: explicit handler arguments, framework locals/context or a documented request decoration. Libraries never install a process-global current identity. Async callbacks must retain the originating request context. Scope checks happen before protected application handlers and use signed scopes. Downstream application errors remain framework errors. Error hooks are awaited and checked before sending; a committed response cannot safely be rewritten. Custom error responses and application logging remain application responsibilities.

OPTIONS is authenticated by default. CORS middleware can answer actual preflights before the guard, but a preflight-looking request is not itself evidence of authentication. Tests cover duplicate headers, invalid tokens on optional paths, context isolation and safe fallback behavior; production routing and middleware ordering still require application review.

## Supply chain and release boundary

Consumers trust the installed tarball and dependency graph as well as the runtime. Exact-artifact package tests, integrity-bound registry tests and provenance are release requirements; local source tests alone do not establish published integrity. Build/test jobs must not receive publishing identity permissions. An approved release candidate cannot acquire runtime or dependency changes during promotion to stable, including executable documentation examples.
