# SvelteKit API example

Build public packages, then pnpm --dir e2e/apps/sveltekit build:app. This executes the
actual adapter-node production build, forbids protected static artifacts, generates
native Kit endpoint types and runs strict TypeScript 7 checks. Node serves build/index.js.
Set ISSUER and optional JWKS_URI at runtime. The shared immutable protect policy uses
deployment paths and is registered through serverlessJwtAdapter in vite.app.config.ts.

pnpm --dir e2e/apps/sveltekit build:cloudflare builds the same app using the real
Cloudflare adapter. Nightly tests run its actual workerd artifact through Wrangler,
including verified HTTPS, warm identity isolation and cold key outage. CLI account/config
state is isolated and no credentials or TLS bypass are used.

Public /public is a real prerendered HTML endpoint. Protected API endpoints remain
prerender=false and use requireAuth. The ordinary Svelte page has static markup and no
load module. Production security tests independently build ignored-error, true/auto,
dynamic/optional/rest/group/escaped, redirect, base and Unicode cases. Missing/mismatched
registration never produces a working hook; an all-dynamic omitted-registration app may
build and then rejects during server startup.

The strict project is tsconfig.types.json, extending native generated $app/tsconfig and
the repo base with skipLibCheck:false, isolated declarations, node and $app/types. src's
tsconfig.json gives lint/editor discovery the same project. Kit 3.1.1's optional app-root
config validator calls removed TypeScript APIs; its page-load generator also emits an
invalid unknown type for +page.ts. The original failures are recorded in compatibility.
No generated types, dependency code or compiler versions are patched. This API-focused
example checks actual generated endpoint route identities; it does not claim full page-load
type generation or type checking inside future Svelte component scripts.

Actual Node ingress keeps the first separate Authorization line. Joined native values
still reject; workerd preserves/rejects actual wire pairs. Encoded aliases, Unicode,
trailing slash, reserved/double encoding and malformed path behavior have actual HTTP
proof. Malformed paths return a fixed no-store 400 before auth/resolve, and the same
server continues to authenticate valid requests.
