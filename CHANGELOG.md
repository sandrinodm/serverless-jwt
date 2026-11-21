# Changelog

[README](README.md)

## 1.0.0 — unreleased

### Security

- Require expiration by default, exact issuer/API audience verification and explicit asymmetric algorithms.
- Bound token, JWKS, network, concurrency and verification resources; recover from discovery/key outages with safe 503 responses and Retry-After.
- Keep signed claims immutable, reject namespace collisions and return fixed non-reflective error descriptions.
- Require provider-specific access-token separation; document unverified shared-audience configurations.

### Breaking

- Replace JwtVerifier construction with createJwtVerifier and verifyAccessToken with verify returning Auth.
- Keep mapped identity separate from signed claims and pass authentication through explicit integration boundaries.
- Require Node 24+ and ship ESM; change helper semantics and swap removeNamespaces arguments.
- Replace legacy handleError callbacks with typed awaited onError hooks.

### Added

- Official framework integrations, portable key ownership policies and generic/RFC 9068 token profiles.
- Scope checks, diagnostics, exact-artifact package tests and standalone public local verification.
- Provider-specific configuration guides.
