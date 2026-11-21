# Amazon Cognito

[README](../../README.md) · [Getting started](../getting-started.md) · [Configuration](../configuration.md) · [Providers](README.md)

## Token product and configuration

This guide covers **Resource-bound user-pool JWT access tokens from supported user authorization flows**. It does not accept ID tokens as API credentials.

Use resource binding in a supported user authorization flow so the access token includes the API resource URL in `aud`. Keep it distinct from the user-pool app client ID used by ID tokens. Ordinary access tokens without `aud`, including ordinary client-credentials M2M tokens, are unsupported by this configuration. Never replace the required API audience with `client_id` or disable audience verification. `token_use` describes the provider product, but generic verification does not enforce that custom claim. The fixture therefore tests both the distinct ID audience and rejection of an audience-less access token.

```ts
import { createJwtVerifier } from '@serverless-jwt/jwt-verifier';

const verifier = createJwtVerifier({
  issuer: 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_example',
  audience: 'https://api.example.com',
  algorithms: ['RS256'],
  profile: 'generic',
});
```

RS256 is the algorithm covered by the synthetic fixtures. Verify your tenant's signing policy before deployment; configure an explicit matching allowlist. Never derive issuer, audience or allowed algorithms from an unverified token.

## Verification and limits

Primary documentation checked **2026-11-11**; review at least quarterly (next due **2027-02-11**) and after provider configuration changes. Hosted issuance and login remain manual and unverified. CI uses locally signed synthetic claim shapes, not provider accounts. The same trusted key and issuer sign access and ID fixtures, so rejection tests the configured audience/profile rather than a bad signature.

The unit fixture verifies an API access token and rejects the documented ID-token shape. The fixture is a compatibility check, not evidence that your tenant currently issues that shape. Inspect locally issued claims without recording tokens, then verify both token products against your deployed policy.

## Primary sources

- [Access-token claims](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html)
- [Resource servers and resource binding](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-define-resource-servers.html)
- [ID tokens](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-id-token.html)
