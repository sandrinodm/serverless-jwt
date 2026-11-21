# Clerk

[README](../../README.md) · [Getting started](../getting-started.md) · [Configuration](../configuration.md) · [Providers](README.md)

## Token product and configuration

This guide covers **Native OAuth JWT access tokens bound to an MCP/API resource URL**. It does not accept ID tokens as API credentials.

Configure the resource URL consistently in Clerk, OAuth metadata and the requesting client, and select JWT access tokens. Verify that actual issued access tokens include that resource audience. The SSO ID-token audience is the OAuth client ID; keep it distinct. ID tokens can contain `jti`, so its presence is not an access-token discriminator. This guide does not cover Clerk session tokens, custom JWT templates, opaque access tokens or M2M tokens; these are separate products and need their own verified configuration. Native RFC 9068 header behavior has not been established here, so do not select that profile on assumption.

```ts
import { createJwtVerifier } from '@serverless-jwt/jwt-verifier';

const verifier = createJwtVerifier({
  issuer: 'https://example.clerk.accounts.dev',
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

- [OAuth token formats](https://clerk.com/docs/guides/development/machine-auth/token-formats)
- [Resource-bound MCP access tokens](https://clerk.com/docs/expressjs/guides/ai/mcp/build-mcp-server)
- [SSO ID tokens](https://clerk.com/docs/guides/configure/auth-strategies/oauth/single-sign-on)
