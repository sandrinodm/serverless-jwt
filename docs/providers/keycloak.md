# Keycloak

[README](../../README.md) · [Getting started](../getting-started.md) · [Configuration](../configuration.md) · [Providers](README.md)

## Token product and configuration

This guide covers **JWT access tokens with an access-token-only API audience mapper**. It does not accept ID tokens as API credentials.

Add an audience mapper for `orders-api` to the requesting client or client scope. Enable Add to access token and disable Add to ID token. Keep the OAuth client ID distinct from the API audience. Both JWT headers can use `typ: JWT`; the payload `typ` is not checked by generic verification. The access-token-only audience mapper is the boundary. See the compatibility record for separately measured local Keycloak grant/rotation evidence. This synthetic guide does not establish live issuance or validate a hosted realm.

```ts
import { createJwtVerifier } from '@serverless-jwt/jwt-verifier';

const verifier = createJwtVerifier({
  issuer: 'https://sso.example.com/realms/example',
  audience: 'orders-api',
  algorithms: ['RS256'],
  profile: 'generic',
});
```

RS256 is the algorithm covered by the synthetic fixtures. Verify your tenant's signing policy before deployment; configure an explicit matching allowlist. Never derive issuer, audience or allowed algorithms from an unverified token.

## Verification and limits

Primary documentation checked **2026-11-11**; review at least quarterly (next due **2027-02-11**) and after provider configuration changes. Hosted issuance and login remain manual and unverified. CI uses locally signed synthetic claim shapes, not provider accounts. The same trusted key and issuer sign access and ID fixtures, so rejection tests the configured audience/profile rather than a bad signature.

The unit fixture verifies an API access token and rejects the documented ID-token shape. The fixture is a compatibility check, not evidence that your tenant currently issues that shape. Inspect locally issued claims without recording tokens, then verify both token products against your deployed policy.

## Primary sources

- [Server administration: audience support](https://www.keycloak.org/docs/latest/server_admin/#audience-support)
- [OIDC endpoints](https://www.keycloak.org/securing-apps/oidc-layers)
