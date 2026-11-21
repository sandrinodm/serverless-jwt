# ZITADEL

[README](../../README.md) · [Getting started](../getting-started.md) · [Configuration](../configuration.md) · [Providers](README.md)

## Unverified token-product separation

**Native ZITADEL JWT access-token configurations with shared project audiences are unverified for this library's generic profile. Do not deploy the following shared-audience setup as an access-token boundary.**

The issuer is the instance's exact HTTPS issuer (for example `https://identity.example.com`). JWT access tokens and ID tokens can both contain the project audience and project client IDs. Both use the same signing infrastructure and `typ: JWT`. Selecting the project ID or a different client from that project as audience therefore does not reliably exclude ID tokens. Generic verification checks signature, issuer, audience and claims, but cannot infer which token product was issued.

The synthetic regression signs an access token and a genuine shared-project-audience ID-token shape with the same key and issuer. Both pass generic verification. That passing ID token demonstrates the unsafe configuration; it is deliberately not described as a successful provider integration. A client-only ID fixture would conceal the actual overlap.

## No assumed discriminator

Do not enable `profile: 'rfc9068'` for native ZITADEL JWTs on the assumption that the header is `at+jwt`. The checked upstream signer explicitly sets `JWT`. Differences such as default `jti`, `nbf`, scopes or authentication claims have not been established as a stable access-only guarantee. Required-claim presence does not establish token purpose. RS256 is covered by the synthetic regression, not a promise about every instance's signing configuration.

Use a separately assessed provider configuration with an enforced access-only discriminator, or a resource-server integration supporting ZITADEL introspection. Token introspection is outside this library's 1.0 scope. No safe native shared-audience configuration is recommended here.

## Verification and sources

Primary docs and upstream source checked **2026-11-11**; review at least quarterly (next due **2027-02-11**). No hosted ZITADEL instance was accessed. These are synthetic shape regressions, not live issuance evidence.

- [Claims matrix](https://zitadel.com/docs/apis/openidoauth/claims)
- [Reserved audience scopes](https://zitadel.com/docs/apis/openidoauth/scopes)
- [Server token construction](https://github.com/zitadel/zitadel/blob/main/internal/api/oidc/token.go)
- [JWT signer type](https://github.com/zitadel/zitadel/blob/main/internal/api/oidc/sign/signer.go)
- [Project/client audience behavior](https://github.com/zitadel/zitadel/issues/9200)
- [Token introspection](https://zitadel.com/docs/guides/integrate/token-introspection)
