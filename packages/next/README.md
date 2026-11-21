# @serverless-jwt/next

[README](../../README.md) · [Getting started](../../docs/getting-started.md) · [Configuration](../../docs/configuration.md) · [Errors](../../docs/errors.md) · [Compatibility](../../docs/compatibility.md)

Bearer access-token authentication for Next.js 16 App Router handlers and proxy.ts.
Requires Node 24+. The exact tested Next peer is 16.4.5.

## Install

```sh
pnpm add @serverless-jwt/next next@16.4.5
pnpm add -D @types/node@26.6.6 @types/react@19.3.0 @types/react-dom@19.3.0 sharp@0.35.5
```

## App Router quick start

```ts
import { withJwt } from '@serverless-jwt/next';

export const GET = withJwt(
  { issuer: 'https://issuer.example', audience: 'https://api.example' },
  async (request, context: { params: Promise<{ id: string }> }, auth) => {
    const { id } = await context.params;
    return Response.json({ id, subject: auth.claims.sub });
  },
);
```

Construct once at module scope. The original NextRequest and original context, including
the params Promise and extra application fields, reach the handler unchanged. Auth lives
only in the third argument. mapClaims infers that argument's identity type.

## Early proxy rejection

```ts
import { createProxyGuard } from '@serverless-jwt/next';
import { NextResponse, type NextRequest } from 'next/server';

const guard = createProxyGuard({
  issuer: 'https://issuer.example',
  audience: 'https://api.example',
});
export async function proxy(request: NextRequest) {
  return (await guard(request)) ?? NextResponse.next();
}
export const config = { matcher: ['/api/:path*'] };
```

The guard returns a rejection Response or undefined to continue. Always verify again in
the route. The proxy never forwards claims through headers, never mutates request headers,
and grants no trusted downstream auth context. Route and proxy factories each own one
verifier/cache. The example includes a route-only endpoint as well as proxy plus route.

## Options and errors

Options accept the core verifier configuration or an existing verifier, exclusively, plus
mode, scopes, scopeMode, skip and onIntegrationDiagnostic. Required mode supplies Auth;
optional missing credentials supply null; explicit synchronous boolean skips supply
undefined and deliberately permit unauthenticated requests. Invalid tokens still reject
in optional mode. Missing credentials reject with 401, malformed or multiple credentials
with 400, scope refusal with 403, and issuer/key outages with 503 plus Retry-After.

Route onError(error, request, context) and proxy onError(error, request) may return or
resolve a Response, or undefined for the default. Keep cache-control: no-store on custom
responses. Thrown, rejected, consumed, locked or unusable results fall back to fixed JSON
and emit integration.on_error_failed without exposing thrown values. Application handler
errors propagate unchanged.

## CORS and deployment

OPTIONS reaching the wrapper is authenticated by default. Next automatically answers
OPTIONS when only GET is exported; export a guarded OPTIONS handler when that method
belongs to the authenticated API (the example does this). Answer actual preflights in CORS middleware before
this guard, or deliberately define a skip policy when unauthenticated access is intended.
Browser page navigation does not supply bearer credentials; restrict proxy matchers to APIs.

The complete example runs next build plus next start and a separate actual Turbopack
next dev smoke. The public types use NextRequest and preserve Next's asynchronous
params contract. Pages API support is a separate subpath.

See [tested compatibility](../../docs/compatibility.md) and the
[complete Next app](../../e2e/apps/next).

## Tested Node ingress limitation

Stock Next 16.4.5 next start discards later separate Authorization header lines before
constructing NextRequest. Real HTTP tests for direct and proxied routes observed 200
for valid-first/invalid-second and 401 for invalid-first/valid-second. The adapter cannot
recover discarded lines. Hosting that requires rejection of repeated wire credentials
must enforce that policy before this Node ingress. Comma-joined credentials and repeated
pairs still present in a NextRequest are always rejected with 400; both orders are tested.
The capability report explicitly records only this separate-line preservation gap.

## Declaration compatibility

The exact Next 16.4.5 / Sharp 0.35.5 combination needs two type-only correction links.
The package automatically loads the real shipped Satori declaration target and maps
Sharp's missing CJS constructor alias to its original ESM interface. No substitute
framework shape is defined. The exact optional Sharp peer exposes Next's existing
transitive dependency for declaration resolution under pnpm; JWT runtime code does
not import Sharp.

Both strict TypeScript 7 NodeNext and Bundler tarball consumers check the original
types, exactness, non-any behavior and rejected invalid APIs. Use Next's generated
next-env setup and ES2024 or newer type libraries. The library runtime target remains
ES2023. Review and remove these corrections as appropriate on every Next or Sharp
version change; neither peer range is widened without new runtime and consumer proof.

## Pages API

Import `withJwtPages` from `@serverless-jwt/next/pages`. It is an independent Node entry with its own declarations and is never re-exported from the root. The request stays unchanged; auth is an explicit third handler argument.

```ts
import { withJwtPages } from '@serverless-jwt/next/pages';
export default withJwtPages(
  { issuer: 'https://issuer.example', audience: 'api' },
  async (_req, res, auth) => {
    res.json(auth.identity);
  },
);
```

`onError(error, request, response)` may finish the actual response and returns void. Before commitment undefined selects the default; after commitment the adapter never sends another body, and hook errors follow Next's error path. Required, optional-null and explicit-skip-undefined auth are inferred. The packed root declaration graph never reaches Pages types, and root runtime modules have no Node imports.

<!-- tested-environments:start -->

## Tested environments

| Area      | Environment or behavior                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| Framework | Next 16.4.5; React/React DOM 19.3.1 in framework apps                                                             |
| Forms     | App Router, proxy and Pages API; actual production builds/start and strict packed consumers                       |
| Limits    | Reviewed Satori/Sharp declaration links; separate wire Authorization lines can be discarded by stock Next ingress |

### Local capability matrix

Duplicate results list the HTTP status for two Authorization header orders, valid first and invalid first.

| Form / host                                    | Project | Route                    | Duplicate results | Measured limits                                                                                          |
| ---------------------------------------------- | ------- | ------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------- |
| next-dev-route / next-development (`.`)        | nightly | `/direct/me/development` | 200 / 401         | not enforceable here: native Next Node ingress retains only the first Authorization wire line            |
| next-dev-proxy / next-development (`.`)        | nightly | `/api/me/development`    | 200 / 401         | not enforceable here: native Next Node ingress retains only the first Authorization wire line            |
| next-pages / next-pages-production (`./pages`) | pr      | `/api/protected`         | 400 / 400         | No measured loss of the tested duplicate-header guarantee.                                               |
| next-route / next-production-route (`.`)       | pr      | `/direct/me/original`    | 200 / 401         | not enforceable here: Next Node ingress discards later raw Authorization lines before NextRequest exists |
| next-proxy / next-production-proxy (`.`)       | pr      | `/api/me/original`       | 200 / 401         | not enforceable here: Next Node ingress discards later raw Authorization lines before NextRequest exists |

<!-- tested-environments:end -->
