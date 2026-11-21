# Microsoft Entra ID

[README](../../README.md) · [Getting started](../getting-started.md) · [Configuration](../configuration.md) · [Providers](README.md)

## Token product and configuration

This guide covers **v2 JWT access tokens for a separately registered API**. It does not accept ID tokens as API credentials.

Register the API separately from the SPA or web client. For v2 access tokens, configure the API application client GUID as audience; the calling application has a different GUID. A v1 access token can instead use an Application ID URI and a different issuer. Align discovery and issuer with the access token version; do not mix v1 and v2 settings. ID tokens for the calling application must not contain the API GUID. Use a tenant-specific issuer; this example is not a multi-tenant authorization policy.

```ts
import { createJwtVerifier } from '@serverless-jwt/jwt-verifier';

const verifier = createJwtVerifier({
  issuer: 'https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/v2.0',
  audience: '22222222-2222-2222-2222-222222222222',
  algorithms: ['RS256'],
  profile: 'generic',
});
```

RS256 is the algorithm covered by the synthetic fixtures. Verify your tenant's signing policy before deployment; configure an explicit matching allowlist. Never derive issuer, audience or allowed algorithms from an unverified token.

## Verification and limits

Primary documentation checked **2026-11-11**; review at least quarterly (next due **2027-02-11**) and after provider configuration changes. Hosted issuance and login remain manual and unverified. CI uses locally signed synthetic claim shapes, not provider accounts. The same trusted key and issuer sign access and ID fixtures, so rejection tests the configured audience/profile rather than a bad signature.

The unit fixture verifies an API access token and rejects the documented ID-token shape. The fixture is a compatibility check, not evidence that your tenant currently issues that shape. Inspect locally issued claims without recording tokens, then verify both token products against your deployed policy.

## Primary sources

- [Validate claims](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation)
- [Access-token claims](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference)
- [ID-token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)
