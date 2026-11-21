# Keys and outages

[README](../README.md) · [Getting started](getting-started.md) · [Configuration](configuration.md) · [Errors](errors.md) · [Providers](providers/README.md)

## Per-verifier ownership

Reuse one verifier for each fixed issuer, audience and policy. Each verifier owns its discovery state, JWKS cache, retry state and fetch budget. There is no process-wide registry or pluggable shared key cache in 1.0: sharing across policies would join separate trust boundaries. Multiple verifier instances fetch independently.

The [configuration reference](configuration.md) contains all bounds and defaults. Fresh keys last 600 seconds by default. A successful refresh replaces the whole set, removing retired keys. A structurally valid JWKS containing zero usable keys clears any previous keys, even with `keys.staleIfError` enabled. Warmup and verification report `jwks_invalid` (503) while that empty set is cached during cooldown. A failed fetch never advances freshness. Generation ordering prevents a slow older response from restoring outdated keys or discovery data.

## Rotation and retry pressure

Unknown key IDs can trigger a refresh, bounded by a per-verifier 30-second cooldown. The refresh attempt reserves that cooldown before network I/O, including failed attempts. An expired cache refresh is independent of the unknown-key cooldown. A random-key flood cannot create an unbounded refresh queue.

Fetch failures use exponential full-jitter backoff capped at 30 seconds. Pending state is cleared after settlement, including failures, so later requests can recover. When cached signing keys are usable, an unknown key during cooldown is an invalid-token/key-not-found failure. A required refresh that cannot reach the issuer is an infrastructure outage. Error responses contain fixed descriptions.

## Outages and stale keys

Default behavior fails closed when no usable fresh key is available: integrations send 503 with a bounded Retry-After. Missing or invalid credentials remain request errors rather than outages. Each network request has a five-second complete response deadline, a decoded-body size limit and a key-count limit. The total verification deadline is ten seconds, including mapping.

`keys.staleIfError` defaults to zero. Enabling it deliberately allows a previously cached key to remain usable during an outage for that additional window after freshness expires. This improves availability but can extend trust in a removed or compromised key. It does not make unknown keys valid or bypass signature, issuer, audience or expiry checks. Each stale use emits a redacted diagnostic. Choose the window as part of your issuer compromise and revocation policy.

```ts
const verifier = createJwtVerifier({
  issuer: 'https://issuer.example.com/',
  audience: 'https://api.example.com',
  keys: { staleIfError: 60 }, // Explicitly accept the extra stale-key risk.
});
```

Import `createJwtVerifier` from `@serverless-jwt/jwt-verifier`. Do not retry 503 indefinitely within one request; honor the platform deadline and apply bounded application retry policy.

## Runtime I/O ownership

Ordinary compatible runtimes can share an in-flight fetch promise within one verifier. Workerd and Vercel Edge prohibit cross-request I/O ownership, so automatic runtime detection disables sharing. Independent cold fetches are bounded by `keys.maxConcurrentFetches` (four by default); excess cold traffic can receive 503. Warm cached requests do not require network I/O.

`shareInflight` is an explicit override for an application that understands its runtime. Do not force it on in workerd or Vercel Edge. Caller cancellation does not abort a shared fetch that another request needs. Custom fetch is trusted policy and receives a signal, but verification still has a deadline when it ignores cancellation. A synchronous callback that never yields cannot be interrupted by a timer.
