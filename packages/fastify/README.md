# @serverless-jwt/fastify

[README](../../README.md) · [Getting started](../../docs/getting-started.md) · [Configuration](../../docs/configuration.md) · [Errors](../../docs/errors.md) · [Compatibility](../../docs/compatibility.md)

Official Fastify 5 integration on Node 24+. `fastify-plugin` is the only framework-specific runtime dependency.

```ts
import { serverlessJwt, getAuth } from '@serverless-jwt/fastify';
import Fastify from 'fastify';
const app = Fastify();
await app.register(serverlessJwt, { issuer: 'https://issuer.example', audience: 'api' });
app.get('/api/me', { onRequest: app.authenticate }, (req) => getAuth(req).identity);
```

There is no global hook by default. For prefix protection, register the plugin and protected routes together inside an encapsulated child:

```ts
await app.register(
  async (api) => {
    await api.register(serverlessJwt, {
      issuer: 'https://issuer.example',
      audience: 'api',
      global: true,
    });
    api.get('/me', (req) => getAuth(req).identity);
  },
  { prefix: '/private' },
);
```

Because `fastify-plugin` breaks encapsulation, `global: true` protects the **parent registration scope**, including descendants. Put it inside the child as shown; public siblings stay public. Child scopes retain their own verifiers. The decorators `authenticate` and `auth` do not overlap with `@fastify/jwt`'s `jwtVerify` and `user` names.

`getAuth<Identity>(request)` checks unknown global auth and throws fixed `auth_context_missing` (500) for absent auth. The global declaration remains `Auth<unknown> | null | undefined`. `onError(error, request, reply)` may send the original reply and returns void. After reply commitment hook errors follow Fastify's error path and the adapter never writes another body.

Construct the factory once at module scope. Required authentication includes OPTIONS. Install framework CORS handling before authentication if it should answer genuine preflights. Optional mode supplies `null` for missing credentials; an explicit synchronous `skip` supplies `undefined`. Invalid credentials always reject. No claims or token contents enter default error responses. Default rejections are JSON and `cache-control: no-store`.

`onError` is awaited with the original platform arguments. Undefined selects the default before response commitment; failures report the fixed `integration.on_error_failed` diagnostic through `onIntegrationDiagnostic`, including when an existing verifier is supplied. Custom responses should retain `cache-control: no-store`. Application handler errors propagate through the framework's normal error path.

<!-- tested-environments:start -->

## Tested environments

| Area                | Environment or behavior                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| Framework endpoints | Fastify 5.0.0 and 5.12.8; fastify-plugin 6.0.1                                |
| Host                | Node 24; actual inject and native HTTP/TCP                                    |
| Coverage            | Encapsulation, request-owned auth, native conformance and strict packed types |

### Local capability matrix

Duplicate results list the HTTP status for two Authorization header orders, valid first and invalid first.

| Form / host                 | Project | Route        | Duplicate results | Measured limits                                            |
| --------------------------- | ------- | ------------ | ----------------- | ---------------------------------------------------------- |
| fastify-node / node24 (`.`) | pr      | `/protected` | 400 / 400         | No measured loss of the tested duplicate-header guarantee. |

<!-- tested-environments:end -->
