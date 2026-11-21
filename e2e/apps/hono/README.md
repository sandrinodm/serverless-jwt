# Hono cross-runtime app

Build public libraries, then pnpm --dir e2e/apps/hono build:app.
The real Hono app is bundled with actual built public-library exports for the four hosts:

- Node: @hono/node-server 2.1.6, src/node.mjs.
- Bun: native Bun.serve, src/bun.mjs.
- Deno: native Deno.serve, src/deno.mjs.
- workerd: actual Wrangler 4.157.0 dev --local, src/worker.mjs.

ISSUER, optional JWKS_URI and PORT are startup configuration. Workerd reads its actual
module-scope cloudflare:workers env bindings, retaining one app/verifier per isolate.
The PR harness sets verified test-CA trust for every runtime; Deno gets only explicit
loopback-network and named-environment permissions. Workerd identity bursts warm the
cache first, independently of the separate cold-capacity runtime proof.

Set DENO_BIN and BUN_BIN to the verified binaries when running pnpm test:e2e locally.
