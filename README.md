# serverless-jwt

[Getting started](docs/getting-started.md) · [Configuration](docs/configuration.md) · [Providers](docs/providers/README.md) · [Development](docs/development.md)

Verify OAuth access tokens in serverless, edge and Node applications. One portable core uses `jose`; official framework integrations extract credentials, enforce scope policy and return safe HTTP errors. Requires Node 24+ for Node consumers; edge packages use Web APIs.

Version 1.0 is unreleased. Use locally packed packages to try it before publication. See the [release guide](docs/releasing.md).

## Quick start

Install `@serverless-jwt/jwt-verifier` at the exact version you intend to evaluate, then create one verifier per trust policy:

```ts
import { createJwtVerifier, requireScopes } from '@serverless-jwt/jwt-verifier';

const verifier = createJwtVerifier({
  issuer: 'https://issuer.example.com/',
  audience: 'https://api.example.com',
  algorithms: ['RS256'],
  mapClaims: (claims) => ({ userId: claims.sub }),
});

const auth = await verifier.verify(accessToken);
requireScopes(auth, ['read:orders']);
const userId = auth.identity.userId;
const signedSubject = auth.claims.sub;
```

For HTTP routes, choose an integration below. [Test locally](docs/examples/verify-locally/README.md) with a loopback issuer before connecting a provider.

## Official integrations

| Package                                                               | Framework or platform                           |
| --------------------------------------------------------------------- | ----------------------------------------------- |
| [`@serverless-jwt/cloudflare`](packages/cloudflare/README.md)         | Workers and Pages Functions                     |
| [`@serverless-jwt/aws-lambda`](packages/aws-lambda/README.md)         | Lambda handler wrappers                         |
| [`@serverless-jwt/vercel`](packages/vercel/README.md)                 | Vercel Functions                                |
| [`@serverless-jwt/netlify`](packages/netlify/README.md)               | Functions v2; Edge and transitional v1 subpaths |
| [`@serverless-jwt/next`](packages/next/README.md)                     | App Router; Pages subpath                       |
| [`@serverless-jwt/express`](packages/express/README.md)               | Express middleware                              |
| [`@serverless-jwt/fastify`](packages/fastify/README.md)               | Fastify plugin                                  |
| [`@serverless-jwt/hono`](packages/hono/README.md)                     | Hono middleware                                 |
| [`@serverless-jwt/sveltekit`](packages/sveltekit/README.md)           | SvelteKit hooks and build registration          |
| [`@serverless-jwt/astro`](packages/astro/README.md)                   | Astro middleware                                |
| [`@serverless-jwt/nuxt`](packages/nuxt/README.md)                     | Nuxt/H3 middleware; h3-v2 subpath               |
| [`@serverless-jwt/tanstack-start`](packages/tanstack-start/README.md) | TanStack React Start and Solid Start            |
| [`@serverless-jwt/react-router`](packages/react-router/README.md)     | React Router                                    |

[Compatibility](docs/compatibility.md) records exact tested environments and remaining limitations. Netlify v1 support is transitional and deprecated from day one; prefer Functions v2. Astro strict TypeScript support requires the documented [SDK declaration repair](docs/astro-sdk-repair.md) after dependency installation.

## Security model

Pin the issuer, an API audience distinct from ID-token audiences, and allowed asymmetric algorithms. The generic profile is the default; opt into RFC 9068 only when the provider issues that token product. [Provider guides](docs/providers/README.md) describe safe configurations and explicitly unverified cases, including shared-audience ZITADEL tokens.

Expiration is required. Discovery and JWKS endpoints require HTTPS except explicit local loopback development. Key outages return 503 and Retry-After; stale keys are disabled by default. Every verifier owns its cache. Signed claims remain immutable and separate from mapped identity; scope checks use signed claims. Library code never logs or includes token contents in errors.

Read [keys and outages](docs/keys-and-outages.md), [scopes and claims](docs/scopes-and-claims.md), the [threat model](docs/security/threat-model.md) and the package README before deployment. This library verifies API access tokens; it does not implement login, sessions, refresh flows, introspection, DPoP or Lambda authorizers.
