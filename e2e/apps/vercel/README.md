# Vercel Web Functions example

Build public libraries, then pnpm --dir e2e/apps/vercel build:app.
The actual Vercel CLI creates .vercel/output functions with runtime nodejs24.x.
The local production host reads the actual .vc-config.json handler and invokes that
built Web function with one argument; real dev --local supplies the optional context.

The build uses local settings without project/account IDs and isolated CLI state.
EXPERIMENTAL_NODE_TYPESCRIPT_ERRORS=1 makes the actual CLI fail on TypeScript errors.
The build config disables isolated declaration emission because the CLI forcibly
disables declaration output; tsconfig.types.json keeps the strict app declaration check.
Explicit local Node type roots resolve correctly from the CLI's temporary config.

Set MIN_NODE_BIN to the verified Node 24 binary for production-host contracts.
The issuer and optional JWKS_URI use the verified HTTPS test CA in local tests.
Actual dev --local has an explicitly reported separate-wire Authorization preservation
gap; joined credentials always reject.

The native development fixture emits the same strictly TypeScript7.0.2-checked
Web handlers as `.mjs` through Vite+Oxc in a disposable app. This avoids loading a
TypeScript transpiler in each native function worker. Vercel CLI65.11.0 still owns
routing, native Request/context creation and function execution; no replacement
HTTP server is used. Source/output hashes and exact compiler evidence are retained
in `reports/e2e/vercel-development.json`.

The native development host creates and discards one worker per request. An actual
cold200 probe returns200 correct identities and records200 JWKS fetches, with zero
issuer requests before the burst. Both native development rounds therefore use
cold verifier caches; a warm-cache guarantee is not claimed for this host. The
separate production Build Output Node24 checks retain cold/warm isolation coverage.
The full native development security row passes with unchanged200 concurrency,
10-second request deadlines and no authenticated warmup.
