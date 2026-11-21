# @serverless-jwt/express

[README](../../README.md) · [Getting started](../../docs/getting-started.md) · [Configuration](../../docs/configuration.md) · [Errors](../../docs/errors.md) · [Compatibility](../../docs/compatibility.md)

Official integration for **Express 5** on Node 24+. Express 4 support is outside the 1.0 scope; Express 5's native asynchronous error handling underpins downstream error propagation. Express 4 users can use `express-oauth2-jwt-bearer`.

```ts
import { jwt, getAuth, requireScopes } from '@serverless-jwt/express';
import express from 'express';
const app = express();
app.use('/api', jwt({ issuer: 'https://issuer.example', audience: 'https://api.example' }));
app.get('/api/me', (req, res) => res.json(getAuth(req).identity));
app.get('/api/admin', requireScopes(['admin']), (_req, res) => res.json({ ok: true }));
```

`getAuth<Identity>(request)` checks for missing auth and throws fixed `auth_context_missing` (500) on an unguarded, skipped or optional-missing route. Global `Request.auth` is `Auth<unknown> | null | undefined`; it cannot promise one factory's identity. Use `getAuth<Identity>` after guarding a required route.

`onError(error, request, response)` can finish the actual Express response and returns void. If headers are already sent the adapter never writes a replacement body; hook exceptions follow `next(error)`.

## Compared with express-oauth2-jwt-bearer

Both protect Express APIs with bearer access tokens. This integration shares its verifier, strict duplicate-credential handling, scopes and safe errors with the other official serverless-jwt integrations. It requires Express 5 and uses checked `getAuth` rather than promising globally typed mutable claims. `express-oauth2-jwt-bearer` remains an alternative for existing Express 4 applications.

Construct the factory once at module scope. Required authentication includes OPTIONS. Install framework CORS handling before authentication if it should answer genuine preflights. Optional mode supplies `null` for missing credentials; an explicit synchronous `skip` supplies `undefined`. Invalid credentials always reject. No claims or token contents enter default error responses. Default rejections are JSON and `cache-control: no-store`.

`onError` is awaited with the original platform arguments. Undefined selects the default before response commitment; failures report the fixed `integration.on_error_failed` diagnostic through `onIntegrationDiagnostic`, including when an existing verifier is supplied. Custom responses should retain `cache-control: no-store`. Application handler errors propagate through the framework's normal error path.

<!-- tested-environments:start -->

## Tested environments

| Area                | Environment or behavior                                                             |
| ------------------- | ----------------------------------------------------------------------------------- |
| Framework endpoints | Express 5.0.0 and 5.3.0                                                             |
| Host                | Node 24 native HTTP and literal TCP header tests                                    |
| Coverage            | Request-owned auth, duplicate rejection, native conformance and strict packed types |

### Local capability matrix

Duplicate results list the HTTP status for two Authorization header orders, valid first and invalid first.

| Form / host                 | Project | Route        | Duplicate results | Measured limits                                            |
| --------------------------- | ------- | ------------ | ----------------- | ---------------------------------------------------------- |
| express-node / node24 (`.`) | pr      | `/protected` | 400 / 400         | No measured loss of the tested duplicate-header guarantee. |

<!-- tested-environments:end -->
