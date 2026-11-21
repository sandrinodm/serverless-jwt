# @serverless-jwt/sveltekit

[README](../../README.md) · [Getting started](../../docs/getting-started.md) · [Configuration](../../docs/configuration.md) · [Errors](../../docs/errors.md) · [Compatibility](../../docs/compatibility.md)

Bearer access-token hooks for SvelteKit 3.1.1 API endpoints, with required production
prerender protection. Published libraries support Node 24+.

## Install

```sh
pnpm add @serverless-jwt/sveltekit @sveltejs/kit@3.1.1
pnpm add -D @types/node@26.6.6
```

## Quick start

Keep one shared immutable policy in a plain module:

```ts
export const protect = Object.freeze(['/api/**']);
```

Register the required adapter wrapper in the real Kit Vite configuration:

```ts
import { serverlessJwtAdapter } from '@serverless-jwt/sveltekit/build';
import node from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

import { protect } from './src/protect';

export default {
  plugins: [sveltekit({ adapter: serverlessJwtAdapter(node(), { protect }) })],
};
```

Create the hook once at module scope:

```ts
import { jwtHandle } from '@serverless-jwt/sveltekit';

import { protect } from './protect';

export const handle = jwtHandle({
  issuer: 'https://issuer.example',
  audience: 'https://api.example',
  protect,
});
```

Protected +server.ts endpoints export prerender=false and use the checked accessor:

```ts
import { requireAuth } from '@serverless-jwt/sveltekit';
export const prerender = false;
export const GET = ({ locals }) => Response.json(requireAuth(locals).identity);
```

The hook composes with real sequence from @sveltejs/kit/hooks. Browser navigation does
not ordinarily carry bearer credentials; protect API paths rather than every page.
Global App.Locals.auth honestly has Auth<unknown> | null | undefined. Applications may
use requireAuth<Identity>(locals) to check presence at a route; absent auth throws Kit's 401. The installed jwtHandle supplies the bare Bearer challenge
and no-store through that request's native setHeaders. Keep that defense for reroutes
and predicate mistakes; unrelated route errors still propagate.

## Protection and prerendering

protect is required in types and at runtime. A nonempty list supports exact absolute
paths and terminal /** subtrees only. Subtrees include their root; trailing slash
variants match, and adjacent segment names do not. Patterns are deployment paths,
including configured paths.base. Percent escapes, general globs, dot segments, empty
lists and ambiguous syntax are rejected. Literal Unicode is supported.

The runtime decodes routing characters once, preserving encoded separators and percent
semantics; it rejects malformed escapes. It never rewrites the platform URL or Request.
Raw URL prefix predicates can miss encoded aliases such as /%61pi/me. A custom predicate
must account for its routing semantics; arbitrary reroute aliases need corresponding
protection or route-level requireAuth. Path patterns cannot analyse arbitrary reroute code.

The required build wrapper uses supported Adapter.vite.plugins and adapt. It preserves
the wrapped adapter's features and plugin forms. Its immutable policy bridge must match
exactly when the hook factory runs; missing/mismatched registration never creates a
working handle, including predicate mode. The ordinary Node sentinel fails closed.
An app with no prerendering may build without registration, then fails at server startup;
registration is not universally detected before startup.

Before adaptation, the wrapper rejects protected concrete pages/assets/redirects and
routes marked true or auto, even if Kit ignores HTTP/unseen-route errors. Exact policies
use public route patterns. Subtree policies conservatively reject prerendered dynamic
or escaped routes whose disjointness cannot be proved; even an unrelated dynamic route
can require prerender=false. No synthetic parameter sampling is used.

Predicate mode must register { protect: 'predicate' } in the build wrapper and provide
an actual synchronous boolean function to jwtHandle. Static analysis is unavailable;
keep production artifact tests for protected routes. Predicates do not imply an empty
protected pattern list.

## Options, errors and CORS

Core verifier configuration or an existing verifier is accepted exclusively, plus mode,
scopes, scopeMode, skip and onIntegrationDiagnostic. Required auth is present; optional
missing credentials produce null; explicit synchronous boolean skips produce undefined.
Unguarded paths produce undefined. Invalid credentials still reject in optional mode.

onError(error, event) may return/resolve Response or undefined for the default. Preserve
cache-control: no-store in custom responses. Thrown, rejected, consumed, locked or unusable
responses use the default and report only integration.on_error_failed. Resolver failures
propagate unchanged. Missing credentials return 401; malformed credentials 400; scope
refusal 403; key outages/cancellation 503 plus Retry-After. Token data is never echoed.
OPTIONS is guarded by default; answer actual preflights deliberately before the hook or
use an explicit skip policy when appropriate.

## Verified scope and limits

The complete API-focused app uses strict TypeScript 7 checks against native generated
endpoint types, actual adapter-node production output and Cloudflare build/runtime tests.
Kit's optional config validator and page-load type generator use removed TypeScript APIs;
the documented example separates the strict project filename and avoids unsupported load
modules. This does not establish complete TypeScript 7 compatibility for page-load typing.

Actual adapter-node ingress drops later separate Authorization lines. Real JWT valid-first
is 200 and reversed order is 401. Joined native credentials still reject with 400. This
transport limitation is explicit in capability reports; upstream/hosted ingress may differ.
See [compatibility](../../docs/compatibility.md) and the [complete app](../../e2e/apps/sveltekit).

<!-- tested-environments:start -->

## Tested environments

| Area      | Environment or behavior                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------- |
| Framework | SvelteKit 3.1.1; adapter-node 6.0.1; adapter-cloudflare 8.0.2                                                  |
| Forms     | Native hooks, sequence composition, build registration and packed SSR consumer                                 |
| Limits    | Required build registration rejects protected static output; predicate protection cannot analyse static output |

### Local capability matrix

Duplicate results list the HTTP status for two Authorization header orders, valid first and invalid first.

| Form / host                                     | Project | Route               | Duplicate results | Measured limits                                                                                                              |
| ----------------------------------------------- | ------- | ------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| sveltekit-worker / adapter-cloudflare (`.`)     | nightly | `/api/me`           | 400 / 400         | No measured loss of the tested duplicate-header guarantee.                                                                   |
| sveltekit-node / adapter-node (`.`)             | pr      | `/api/me`           | 200 / 401         | not enforceable here: adapter-node constructs Request from Node headers after later Authorization values are discarded       |
| sveltekit-build / vite-build-policy (`./build`) | pr      | `build-time policy` | 400 / 400         | build-only entry point: no HTTP ingress; runtime rejection is covered by sveltekit-node Build-only policy: no HTTP response. |

<!-- tested-environments:end -->
