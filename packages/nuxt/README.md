# @serverless-jwt/nuxt

[README](../../README.md) · [Getting started](../../docs/getting-started.md) · [Configuration](../../docs/configuration.md) · [Errors](../../docs/errors.md) · [Compatibility](../../docs/compatibility.md)

Official Nuxt 4 / Nitro 2 integration using h3 v1 and original Node `IncomingMessage` headers. The `@serverless-jwt/nuxt/h3-v2` entry supports real h3 v2 hosts with Web Requests. The package peer is `h3 ^1.15 || ^2.0.1`; choose the matching entry. Nuxt itself is not a peer.

```ts
// server/middleware/auth.ts
import { jwtMiddleware } from '@serverless-jwt/nuxt';
export default jwtMiddleware({
  issuer: 'https://issuer.example',
  audience: 'https://api.example',
  protect: ['/api/**'],
});
import { getAuth } from '@serverless-jwt/nuxt';
// server/api/me.get.ts
import { defineEventHandler } from 'h3';
export default defineEventHandler((event) => getAuth(event).identity);
```

`protect` is mandatory: a nonempty array of absolute exact paths or terminal `/**` subtrees, or a synchronous `(event) => boolean` predicate. Patterns are validated and copied once. Subtrees include their root; segment boundaries matter. Ambiguous globs, encoding, traversal and empty lists reject configuration. Requests outside the selector retain any existing authentication context. Explicit skips set auth to `undefined`, and optional missing credentials set it to `null`. Routing decodes literal characters as h3 does while preserving encoded slash and percent boundaries. The root entry also recognizes h3 v1's decoded query boundary; for example, `/api%3Fignored` still protects the `/api` route.

Predicates receive the original native event before authentication. `false` preserves its existing auth.
`true` applies the configured required, optional or skip policy. Throws, nonboolean results and
thenables fail closed with fixed 500 `server_error` (internal reason `adapter_misconfigured`), using the existing
`onError` path; rejected thenables are observed without waiting. Patterns remain the preferred
form when routing alone determines protection.

The root predicate is contextually typed as h3 v1's actual `H3Event`. The v2 event subtype
can be inferred from a native `H3.use` context or an explicitly annotated SDK predicate.
A standalone unannotated predicate defaults to the separate `WebEvent` boundary (`req` and
`context`). Annotate the installed SDK event when its full API is needed outside a host
context. The inferred subtype also types `onError` and the middleware input, so native
`H3.use` still checks assignability:

```ts
import type { H3Event } from 'h3';

import { jwtMiddleware } from '@serverless-jwt/nuxt/h3-v2';

app.use(
  jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'https://api.example',
    protect: (event: H3Event) => event.url.pathname.startsWith('/api/'),
  }),
);
```

Use `getAuth<Identity>(event)` to check context before accessing the application-owned identity. It throws fixed `auth_context_missing` (500) without auth. The h3 v1 context augmentation is `Auth<unknown> | null | undefined`. The v2 entry uses a structural event boundary and checked accessor to keep its declarations entirely independent of the incompatible h3 v1 declarations. Actual h3 v2 `H3.use` assignability is checked. Neither declaration entry imports the other, and strict packed consumers install each h3 major separately.

`onError(error, event)` returns a Web Response or undefined. Consumed or locked responses fail back to the default. The h3 v1 entry reads custom response bytes before commitment, preserving binary bodies and separate Set-Cookie fields, and falling back with a diagnostic if the body cannot be read. It never writes after the original Node response is committed. The root listens for native Node disconnects; the v2 entry forwards the original request signal.

Construct the factory once at module scope. Required authentication includes OPTIONS. Install framework CORS handling before authentication if it should answer genuine preflights. Optional mode supplies `null` for missing credentials; an explicit synchronous `skip` supplies `undefined`. Invalid credentials always reject. No claims or token contents enter default error responses. Default rejections are JSON and `cache-control: no-store`.

`onError` is awaited with the original platform arguments. Undefined selects the default before response commitment; failures report the fixed `integration.on_error_failed` diagnostic through `onIntegrationDiagnostic`, including when an existing verifier is supplied. Custom responses should retain `cache-control: no-store`. Application handler errors propagate through the framework's normal error path.

For strict standalone type checking, h3 v1 uses the WebWorker standard library,
which is also present in Nuxt's generated server configuration and supplies its
FetchEvent declaration. The separate v2 consumer uses DOM plus ESNext.Error and
h3's own optional crossws declaration peer (exact tested version 0.4.17). Node
24.0.0 provides Error.isError. These standard-library choices retain strict
library checking; no handwritten global event stub is needed. See the tested
compatibility guide for separate NodeNext and bundler consumer evidence.

<!-- tested-environments:start -->

## Tested environments

| Area                      | Environment or behavior                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Nuxt/h3 v1                | Nuxt 4.6.4; Nitro 2.13.6; h3 1.15.0 and 1.15.11                                                                                     |
| h3 v2                     | h3 2.0.1 and 2.0.8; actual Web Requests and toNodeHandler                                                                           |
| Coverage                  | Pattern/predicate boundaries, native event inference, Node 24 production hosts and strict packed consumers                          |
| Independent nightly hosts | Standalone Nitro 2.13.6/h3 v1 and SolidStart 2.2.1/Nitro 3/h3 v2. The SolidStart fixture uses pinned workspace declaration patches. |

### Local capability matrix

Duplicate results list the HTTP status for two Authorization header orders, valid first and invalid first.

| Form / host                                         | Project | Route        | Duplicate results | Measured limits                                            |
| --------------------------------------------------- | ------- | ------------ | ----------------- | ---------------------------------------------------------- |
| nuxt-nitro / nitro-node (`.`)                       | nightly | `/protected` | 400 / 400         | No measured loss of the tested duplicate-header guarantee. |
| nuxt-solidstart / solidstart-nitro-node (`./h3-v2`) | nightly | `/protected` | 400 / 400         | No measured loss of the tested duplicate-header guarantee. |
| nuxt / nuxt-nitro-node (`.`)                        | pr      | `/protected` | 400 / 400         | No measured loss of the tested duplicate-header guarantee. |
| nuxt-h3-v2 / h3-v2-node (`./h3-v2`)                 | pr      | `/protected` | 400 / 400         | No measured loss of the tested duplicate-header guarantee. |

<!-- tested-environments:end -->
