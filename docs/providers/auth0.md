# Auth0

[README](../../README.md) · [Getting started](../getting-started.md) · [Configuration](../configuration.md) · [Providers](README.md)

## Token product and configuration

This guide covers **Auth0 API access tokens with the API explicitly set to the RFC 9068 access-token profile**. It does not accept ID tokens as API credentials.

Create an API with identifier `https://api.example.com`, separate from the OAuth application client ID. Select the RFC 9068 profile for that API; the default Auth0 profile is a different token product. Request this API audience during authorization. The configured profile emits the access-token type checked by `rfc9068`. An ID token has the application client audience and `typ: JWT`; the fixture also tests a same-audience ID token to prove the type check.

```ts
import { createJwtVerifier } from '@serverless-jwt/jwt-verifier';

const verifier = createJwtVerifier({
  issuer: 'https://tenant.auth0.com/',
  audience: 'https://api.example.com',
  algorithms: ['RS256'],
  profile: 'rfc9068',
});
```

RS256 is the algorithm covered by the synthetic fixtures. Verify your tenant's signing policy before deployment; configure an explicit matching allowlist. Never derive issuer, audience or allowed algorithms from an unverified token.

## Verification and limits

Primary documentation checked **2026-11-11**; review at least quarterly (next due **2027-02-11**) and after provider configuration changes. Hosted issuance and login remain manual and unverified. CI uses locally signed synthetic claim shapes, not provider accounts. The same trusted key and issuer sign access and ID fixtures, so rejection tests the configured audience/profile rather than a bad signature.

The unit fixture verifies an API access token and rejects the documented ID-token shape. The fixture is a compatibility check, not evidence that your tenant currently issues that shape. Inspect locally issued claims without recording tokens, then verify both token products against your deployed policy.

## Primary sources

- [Access-token profiles](https://auth0.com/docs/secure/tokens/access-tokens/access-token-profiles)
- [Validate access tokens](https://auth0.com/docs/secure/tokens/access-tokens/validate-access-tokens)
