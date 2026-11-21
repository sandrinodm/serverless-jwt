# WorkOS

[README](../../README.md) · [Getting started](../getting-started.md) · [Configuration](../configuration.md) · [Providers](README.md)

## Token product and configuration

This guide covers **WorkOS Connect user access tokens requested for a distinct API resource**. It does not accept ID tokens as API credentials.

Use your AuthKit domain as issuer and its `/oauth2/jwks` endpoint. Request the distinct API resource in a supported user flow. Connect user access tokens use the requested resource, or the environment client ID when no resource is configured. ID tokens use the requesting OAuth application client ID; those are different concepts. M2M access tokens have the fixed environment client ID audience, not a customizable API template; that product is outside this resource-bound example. This guide does not cover AuthKit session tokens or claim native RFC 9068 headers.

```ts
import { createJwtVerifier } from '@serverless-jwt/jwt-verifier';

const verifier = createJwtVerifier({
  issuer: 'https://auth.example.com',
  audience: 'https://api.example.com',
  algorithms: ['RS256'],
  profile: 'generic',
  jwksUri: 'https://auth.example.com/oauth2/jwks',
});
```

RS256 is the algorithm covered by the synthetic fixtures. Verify your tenant's signing policy before deployment; configure an explicit matching allowlist. Never derive issuer, audience or allowed algorithms from an unverified token.

## Verification and limits

Primary documentation checked **2026-11-11**; review at least quarterly (next due **2027-02-11**) and after provider configuration changes. Hosted issuance and login remain manual and unverified. CI uses locally signed synthetic claim shapes, not provider accounts. The same trusted key and issuer sign access and ID fixtures, so rejection tests the configured audience/profile rather than a bad signature.

The unit fixture verifies an API access token and rejects the documented ID-token shape. The fixture is a compatibility check, not evidence that your tenant currently issues that shape. Inspect locally issued claims without recording tokens, then verify both token products against your deployed policy.

## Primary sources

- [Connect access-token claims](https://workos.com/docs/authkit/connect/token-claims)
- [Connect token endpoint and ID-token claims](https://workos.com/docs/reference/workos-connect/token)
