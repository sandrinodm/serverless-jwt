# Okta

[README](../../README.md) · [Getting started](../getting-started.md) · [Configuration](../configuration.md) · [Providers](README.md)

## Token product and configuration

This guide covers **JWT access tokens from an Okta custom authorization server**. It does not accept ID tokens as API credentials.

Configure a custom authorization server `/oauth2/{authorizationServerId}` with an API audience distinct from every OAuth client ID. Its issuer must match exactly. Do not use the org authorization server for your API: its access tokens are intended for Okta APIs. Both products may use `typ: JWT`; the distinct audience provides the separation. `scp` supplies scopes, but claim presence alone is not the token-product boundary.

```ts
import { createJwtVerifier } from '@serverless-jwt/jwt-verifier';

const verifier = createJwtVerifier({
  issuer: 'https://example.okta.com/oauth2/default',
  audience: 'api://orders',
  algorithms: ['RS256'],
  profile: 'generic',
});
```

RS256 is the algorithm covered by the synthetic fixtures. Verify your tenant's signing policy before deployment; configure an explicit matching allowlist. Never derive issuer, audience or allowed algorithms from an unverified token.

## Verification and limits

Primary documentation checked **2026-11-11**; review at least quarterly (next due **2027-02-11**) and after provider configuration changes. Hosted issuance and login remain manual and unverified. CI uses locally signed synthetic claim shapes, not provider accounts. The same trusted key and issuer sign access and ID fixtures, so rejection tests the configured audience/profile rather than a bad signature.

The unit fixture verifies an API access token and rejects the documented ID-token shape. The fixture is a compatibility check, not evidence that your tenant currently issues that shape. Inspect locally issued claims without recording tokens, then verify both token products against your deployed policy.

## Primary sources

- [Authorization servers](https://developer.okta.com/docs/concepts/auth-servers/)
- [Validate access tokens](https://developer.okta.com/docs/guides/validate-access-tokens/main/)
