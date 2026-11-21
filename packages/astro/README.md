# @serverless-jwt/astro

[README](../../README.md) · [Getting started](../../docs/getting-started.md) · [Configuration](../../docs/configuration.md) · [Errors](../../docs/errors.md) · [Compatibility](../../docs/compatibility.md)

Bearer access-token middleware for Astro 7.4.5 APIs with required protected-prerender
checks. Published libraries support Node 24+.

## Install

```sh
pnpm add @serverless-jwt/astro astro@7.4.5
pnpm add -D @types/node@26.6.6 @astrojs/markdown-remark@7.3.5 mongodb@7.8.0 ioredis@5.11.1
pnpm add -D @types/unist@3.0.3 @types/hast@3.0.5 @types/mdast@4.0.4
```

## Required declaration repair

Astro 7.4.5 publishes incomplete declarations. After every dependency installation,
run this explicit step before checking TypeScript types or building the app:

```sh
node --input-type=module -e "import { repairAstroTypes } from '@serverless-jwt/astro/type-repair'; repairAstroTypes()"
```

This package ships audited declaration corrections and their source/license inventory.
The command verifies the exact Astro 7.4.5 and unstorage 1.17.6 files, then replaces only
Astro and markdown declarations and adds one unstorage declaration companion. Runtime JavaScript and
this package's installed artifact stay unchanged. It retains the real framework types
and the original MongoDB, Redis and LRU class declarations. The listed development
packages are genuine type peers required by the framework declaration graph; the
TypeScript checker remains TypeScript 7.

The installation must be writable. Package imports never apply the repair, and there
are no installation lifecycle hooks. Repeat the command after reinstalling dependencies;
a repeat invocation is safe. Unknown versions or changed SDK files are rejected before
writes. To verify an existing repair without changing files, call
`repairAstroTypes({ check: true })` instead.

Run the command from the application directory. For a pnpm workspace app whose
node_modules lives at the workspace root, explicitly select that installation boundary:

```sh
node --input-type=module -e "import { repairAstroTypes } from '@serverless-jwt/astro/type-repair'; repairAstroTypes({ installationRoot: '../..' })"
```

The application, selected Astro/unstorage copies and this package must all belong to
that installation. The command repairs the application's selected SDK copy; other
applications with different copies run their own explicit step. A successful untouched
installation alone does not establish strict Astro declaration compatibility.

## Quick start

Share one immutable deployment-path policy:

```ts
export const protect = Object.freeze(['/api/**']);
```

Register the integration in astro.config.mjs:

```ts
import node from '@astrojs/node';
import { serverlessJwt } from '@serverless-jwt/astro/build';
import { defineConfig } from 'astro/config';

import { protect } from './src/protect';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [serverlessJwt({ protect })],
});
```

Create src/middleware.ts once at module scope:

```ts
import { jwtMiddleware } from '@serverless-jwt/astro';

import { protect } from './protect';
export const onRequest = jwtMiddleware({
  issuer: 'https://issuer.example',
  audience: 'https://api.example',
  protect,
});
```

Protected endpoints render on demand and use checked access:

```ts
import type { APIRoute } from 'astro';

import { requireAuth } from '@serverless-jwt/astro';
export const prerender = false as const;
export const GET: APIRoute = ({ locals }) => Response.json(requireAuth(locals).identity);
```

Astro 7's raw prerender parser requires the literal assignment form; a `: boolean`
annotation before the initializer is ignored. The const assertion retains explicit
TypeScript checking and recognized framework syntax.

## Protection and static output

protect is mandatory in types and at runtime. A nonempty list accepts exact absolute
paths and terminal /** subtrees. Subtrees include their root, respect segment boundaries
and accept trailing-slash variants. Patterns describe deployment paths including base.
Percent pattern syntax, dot segments and general globs are rejected; Unicode is supported.

The required integration binds an immutable policy to middleware through supported
Astro/Vite hooks. Missing or mismatched registration never constructs working middleware,
including predicate mode. Ordinary imports are safe; an explicit unregistered sentinel
rejects factory use. Apps with no prerendering may build and fail when middleware loads.

The build guard captures actual routes at astro:routes:resolved and checks their
isPrerendered status at astro:build:done. This catches protected endpoints missing from
build:done.pages. It also checks actual emitted client asset URLs; asset-map keys can name
non-prerendered routes and are not emitted paths. Exact policies use native route regexes;
subtree policies conservatively reject ambiguous prerendered dynamic/rest routes. Unrelated
dynamic prerendering may therefore require an exact policy or prerender=false.

Predicates register { protect: 'predicate' } in the integration and an actual synchronous
boolean function in middleware. Static analysis is unavailable; retain production artifact
tests. Invalid/throwing predicates fail closed with the canonical adapter error. Arbitrary
reroute aliases require corresponding protection or checked route access.

Astro normalizes incoming paths before middleware. Runtime/build matching follows bounded
routing decoding and never returns a partially decoded protected name. Malformed paths
reaching the adapter get a fixed no-store 400; the actual Node/Astro early URI rejection
has its own response. Neither path invokes protected handlers.

## Auth, errors and CORS

Global App.Locals.auth has Auth<unknown> | null | undefined, because factories cannot
safely specialize one global type. requireAuth<Identity>(locals) checks presence and returns
that request's auth. Under the installed jwtMiddleware, missing or optional-null auth
returns 401 with the bare Bearer challenge and no-store, including paths missed by protect.
Keep this endpoint defense alongside the middleware; unrelated route errors still propagate.
Browser page navigation does not ordinarily carry bearer credentials; select API paths.

Core configuration or an existing verifier is accepted exclusively, plus mode, scopes,
scopeMode, skip and onIntegrationDiagnostic. Required auth is present; optional missing
credentials are null; explicit skips and unprotected paths have undefined. Invalid tokens
still reject in optional mode. Request/context/body are not rewritten or consumed.

onError(error, context) may return/resolve Response or undefined for the default. Preserve
cache-control: no-store in custom responses. Thrown, rejected, consumed, locked or unusable
responses use the default and emit only integration.on_error_failed. Downstream exceptions
propagate unchanged. Missing credentials return 401, malformed credentials 400, scopes 403,
and outages/cancellation 503 plus Retry-After. Errors never echo token data. OPTIONS is
guarded by default; answer actual preflights before authentication or deliberately skip.

## Tested ingress

Actual @astrojs/node 11.1.9 standalone ingress keeps only the first separate Authorization
line: real JWT valid-first is 200, reversed order is 401. The discarded values cannot be
recovered; enforce repeated-wire rejection before such ingress if needed. Joined values
and pairs still present in native Request reject with 400. Hosted ingress is unverified.
See [compatibility](../../docs/compatibility.md) and the [complete app](../../e2e/apps/astro).

<!-- tested-environments:start -->

## Tested environments

| Area             | Environment or behavior                                                              |
| ---------------- | ------------------------------------------------------------------------------------ |
| Framework        | Astro 7.4.5; @astrojs/node 11.1.9 standalone                                         |
| Runtime          | Local production server and native middleware authentication checks                  |
| Strict SDK types | Strict NodeNext and Bundler consumers require the explicit Astro declaration repair. |

### Local capability matrix

Duplicate results list the HTTP status for two Authorization header orders, valid first and invalid first.

| Form / host                                                        | Project | Route                                     | Duplicate results | Measured limits                                                                                                                                                           |
| ------------------------------------------------------------------ | ------- | ----------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| astro-node / astro-node-standalone (`.`)                           | pr      | `/api/me`                                 | 200 / 401         | not enforceable here: standalone Astro ingress drops later raw Authorization lines before middleware receives Request                                                     |
| astro-type-repair / node-declaration-preparation (`./type-repair`) | pr      | `read-only declaration preparation check` | N/A               | not enforceable here: declaration preparation has no HTTP ingress or response; runtime authentication is covered by astro-node Declaration preparation: no HTTP response. |
| astro-build / astro-build-policy (`./build`)                       | pr      | `build-time policy`                       | 400 / 400         | build-only entry point: no HTTP ingress; runtime behavior is covered by astro-node Build-only policy: no HTTP response.                                                   |

<!-- tested-environments:end -->
