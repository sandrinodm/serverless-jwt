# Getting started

[README](../README.md) · [Getting started](getting-started.md) · [Configuration](configuration.md) · [Errors](errors.md) · [Providers](providers/README.md)

## Choose and install

Use the [official integration](../README.md#official-integrations) for your framework. The core is for direct token verification and is also a dependency of each integration. Consult [compatibility](compatibility.md) for the tested framework/runtime pair and each package README for its public imports.

Choose an exact published candidate or stable version; publication is currently pending. From your application's directory:

```sh
: "${JWT_VERSION:?set JWT_VERSION to the exact published version to evaluate}"
pnpm add --save-exact "@serverless-jwt/jwt-verifier@$JWT_VERSION"
```

Install your selected integration at the same version. Do not install the private testkit. For a local source candidate, [the standalone example](examples/verify-locally/README.md) accepts the exact packed core tarball instead.

## Configure your trust policy

Obtain the exact issuer, API audience and signing algorithm from your identity provider configuration. Use an API audience that ID tokens cannot match; never copy an arbitrary incoming token's audience into configuration. Read your [provider guide](providers/README.md): some providers need an explicit resource or audience mapper. Shared-audience configurations can be unsafe even with valid signatures.

```ts
import { createJwtVerifier } from '@serverless-jwt/jwt-verifier';

const verifier = createJwtVerifier({
  issuer: 'https://issuer.example.com/',
  audience: 'https://api.example.com',
  algorithms: ['RS256'],
});
```

Create this once at module scope. OIDC discovery is the default; set a trusted `jwksUri` for direct keys. Enable `profile: 'rfc9068'` only when your provider explicitly emits that access-token profile. Never pass an ID token, session token or refresh token as an API credential.

## Protect a route

The Cloudflare example shows the explicit auth argument; other frameworks use their own typed boundaries:

```ts
import { withJwt } from '@serverless-jwt/cloudflare';

export default {
  fetch: withJwt(
    { issuer: 'https://issuer.example.com/', audience: 'https://api.example.com' },
    async (request, env, context, auth) => Response.json({ subject: auth.claims.sub }),
  ),
};
```

Required mode rejects a missing token. Optional mode permits missing credentials with `null` auth, but still rejects invalid tokens. `skip` deliberately permits unauthenticated requests. Preflights are authenticated by default: put the platform's CORS middleware before the guard to answer actual preflights.

## Verify locally and handle outages

Run the [standalone public example](examples/verify-locally/README.md) outside the checkout. It creates a loopback JWKS issuer and tests valid, missing, invalid and insufficient-scope credentials plus mapped identity. Its keys and tokens are disposable; never use them in production.

Expect fixed [400/401/403/503/500 errors](errors.md). A 503 indicates verification infrastructure is temporarily unavailable; clients should preserve valid credentials and honor Retry-After. Review [stale-key trade-offs](keys-and-outages.md) before changing the default. Avoid logging whole `Auth` objects because `auth.token` retains the original bearer credential for delegation.
