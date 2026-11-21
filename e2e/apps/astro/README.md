# Astro API example

Run `pnpm --dir e2e/apps/astro build:app`. It builds the public libraries, explicitly
repairs the SDK declarations, then runs Astro with @astrojs/node standalone output. It
forbids protected static artifacts, generates native types and checks app/package types
with TypeScript 7. Run dist/server/entry.mjs with ISSUER and optional JWKS_URI. The public
Astro page prerenders; API endpoints remain dynamic.

After installing dependencies, first build the public entry points with
`pnpm --dir e2e/apps/astro prepare:peers`, then run the required declaration preparation
with `pnpm --dir e2e/apps/astro repair:types`. It calls the public
`repairAstroTypes({ installationRoot: '../../..' })` entry described in the
[SDK repair contract](../../../docs/astro-sdk-repair.md). `test:types` applies it before
`astro sync`; `build:app` applies it after building the libraries and before Astro builds.
Repeated calls verify the same installation and make no further changes.

The example declares six additional development type peers through exact catalogs:
@astrojs/markdown-remark, @types/hast, @types/mdast, @types/unist, mongodb and ioredis.
Its development-only supports-color 7.2.0 pin makes pnpm select the same physical
markdown/Redis copies for the application and linked workspace integration. The repair's
package-identity and installation-boundary checks remain active.

The shared immutable policy is registered through serverlessJwt in astro.config.mjs and
consumed by jwtMiddleware. The integration is required: missing/mismatched registration
never yields working middleware. Protected endpoints also use requireAuth.

Use the recognized literal `prerender = false as const` export form. Actual Astro
ignores an annotation between the variable name and initializer during raw prerender parsing.
The const assertion retains explicit static checking without changing that syntax.

Production tests use real route metadata, dynamic/rest endpoints, redirects, Unicode/base
paths and an actual client asset associated with an unrelated route. They assert the
original guard reason so unrelated build failures cannot count as protection. Asset-map
keys include non-prerendered routes; guards check actual emitted URLs instead.

HTTP tests prove verified HTTPS OIDC, two 200-identity rounds, encoded/Unicode routing,
forged preflights, invalid credentials and key outage. The standalone header-preservation
gap is explicitly reported. Native malformed URI responses occur before middleware;
the adapter's own exact no-store 400 unit regression remains separate and unchanged.
