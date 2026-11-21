# TanStack React and Solid examples

This private workspace contains complete React Start and Solid Start 1.169.4 apps, each
with real Vite/Start compilation and Nitro 3.0.261103-rc production output. Both public
callback forms use first-party createMiddleware(...).server(jwt...(options)) composition.
Options stay inside that compiler boundary. Two additional native middleware levels retain
the mapped identity. No custom src/start.ts replaces the framework's default CSRF setup.

Run `pnpm --filter @serverless-jwt/tanstack-start... build`, then
`pnpm --dir e2e/apps/tanstack-start build:app`. Each build clears only its own generated
.output directory because Nitro can retain stale public chunks. Every fresh browser JS/map
artifact is scanned for private policy, verifier diagnostics and server-only Node imports.
Both actual production servers require ISSUER and optionally JWKS_URI.

Nitro's supported features.fastResponse:false setting is required: its default replacement
loses HTTP status when Start copies RPC responses. The library checks actual semantics at
factory construction and request dispatch, including replacement after construction. Run
`pnpm --dir e2e/apps/tanstack-start test:response` for actual misconfigured native negative
controls, then build:app to restore supported outputs. The private P4_NITRO_FAST_RESPONSE
build variable exists only for that negative control.

Normal ready and peer checks build the native route tree and run TypeScript 7 against both
apps, including generated route/RPC types. Only these non-emitting private app configs set
isolatedDeclarations:false: the upstream generated tree contains inferred exports that
cannot satisfy isolated declarations. Strict/noEmit and all other checks remain. Published
library/declaration and packed NodeNext/Bundler gates retain their existing settings. Run
`node e2e/apps/tanstack-start/types.mjs --prove-negative` for included native route/context
TS2322 red/green with byte-exact restoration, effective configs and included-file evidence.

The test harness checks verified HTTPS OIDC and two rounds of 200 identities per public form
on each framework. It also checks raw and ordinary serialized RPC, absence of server auth
context/token in serialized replies, native cross-origin CSRF rejection, original resource
methods, forged OPTIONS, encoded routes, comma/separate duplicates, bad audience and cold
key outage with exact Retry-After. `/ready` is an independent public resource. `/rpc-info`
returns only compiler-generated public function addresses already present in client stubs.
