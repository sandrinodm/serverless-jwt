# @serverless-jwt/react-router

[README](../../README.md) · [Getting started](../../docs/getting-started.md) · [Configuration](../../docs/configuration.md) · [Errors](../../docs/errors.md) · [Compatibility](../../docs/compatibility.md)

Bearer access-token middleware for React Router 8.5.1 resource routes and API loaders.
Published packages support Node 24+. Middleware is stable in this verified version;
no middleware future flag is required.

## Install

```sh
pnpm add @serverless-jwt/react-router react-router@8.5.1
```

TypeScript applications use the framework's real React declarations. The tested optional
type peers are @types/react 19.3.0 and @types/react-dom 19.3.0.

## Quick start

```ts
import type { LoaderFunctionArgs } from 'react-router';

import { createAuthContext, jwtMiddleware } from '@serverless-jwt/react-router';

export const authContext = createAuthContext<{ subject: string }>();
export const middleware = [
  jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'https://api.example',
    context: authContext,
    mapClaims: (claims) => ({ subject: String(claims.sub) }),
  }),
];
export function loader({ context }: LoaderFunctionArgs) {
  const auth = context.get(authContext);
  if (!auth) throw new Error('Missing protected-route authentication');
  return Response.json({ subject: auth.identity.subject });
}
```

Create each factory and context once at module scope. The context is required at both the
type and runtime boundaries. Attach middleware to the protected matched route or common
ancestor; raw pathname prefix checks can miss encoded route aliases. Authentication lives
only in the request's native RouterContextProvider. Two contexts can carry independent
identity types. An untouched context has no default and its native get throws.

## Options and errors

Options accept core verifier configuration or an existing verifier, exclusively, plus
mode, scopes, scopeMode, skip and onIntegrationDiagnostic. Required authentication is the
default. Optional missing credentials produce null; invalid credentials still reject.
Explicit synchronous boolean skip produces undefined. The app-owned context honestly
includes all three states, so check it before accessing identity.

onError(error, args) receives the original native middleware args and may return or await
a Response, or undefined for the default. Preserve cache-control: no-store on custom
responses. Thrown, rejected, consumed, locked and unusable hook results emit the fixed
integration.on_error_failed diagnostic and fall back before downstream code runs.
Downstream next results and exceptions remain owned by the framework.

Default failures use fixed JSON descriptions: missing 401, malformed or multiple credentials
400, insufficient scopes 403, and outages or cancellation 503 with Retry-After. Responses
have no-store and the appropriate RFC 6750 challenge.

## Browser navigation, CORS and deployment

Browser page navigation does not send bearer Authorization headers. This integration is
for resource routes and API loaders/actions whose callers explicitly supply access tokens;
it does not create a browser session or cookie login.

OPTIONS is authenticated by default, including forged preflight requests. Install deliberate
CORS handling before this middleware when public preflights are required, or choose an
explicit skip policy. Protected loaders and actions share the same middleware.

The complete example builds with react-router build and runs actual react-router-serve.
The verified local ingress retains only the first separate Authorization wire line: a
valid first token yields 200 and reversing it yields 401. Those discarded duplicates cannot
be recovered. Native comma-joined header values still reject with 400. Hosted ingress is
unverified; retain those checks when changing the host.

## Compared with framework authentication

React Router supplies middleware and typed contexts, leaving credential policy to the app.
This package adds issuer discovery, bounded key caching/outage behavior, scope checks and
fixed bearer errors. It verifies resource-server access tokens and does not issue tokens.

See [the tested example](../../e2e/apps/react-router/README.md),
[compatibility](../../docs/compatibility.md) and [integration authoring](../../docs/integration-author.md).

<!-- tested-environments:start -->

## Tested environments

| Area      | Environment or behavior                                               |
| --------- | --------------------------------------------------------------------- |
| Framework | React Router 8.5.1 and react-router-serve 8.5.1                       |
| Forms     | Production resource/API routes and application-owned typed context    |
| Coverage  | Native middleware conformance, strict types and local production HTTP |

### Local capability matrix

Duplicate results list the HTTP status for two Authorization header orders, valid first and invalid first.

| Form / host                             | Project | Route     | Duplicate results | Measured limits                                                                                                 |
| --------------------------------------- | ------- | --------- | ----------------- | --------------------------------------------------------------------------------------------------------------- |
| react-router / react-router-serve (`.`) | pr      | `/api/me` | 200 / 401         | not enforceable here: standalone react-router-serve drops later Authorization lines before Request construction |

<!-- tested-environments:end -->
