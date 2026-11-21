# Cloudflare example

The Worker and Pages Functions middleware both use original runtime bindings. Configure
ISSUER and an API audience for your deployment. Local tests run Wrangler 4.157.0 in a
clean environment with isolated configuration and the synthetic issuer CA through
NODE_EXTRA_CA_CERTS. Miniflare explicitly forwards that additional CA into workerd TLS;
certificate and issuer verification remain enabled.

From the repository root, build the public packages, then run `pnpm test:e2e`.
Native Workers and Pages conformance runs through `pnpm --dir e2e/apps/cloudflare test:conformance`.
The native suite separately checks independent I/O/cold capacity and warmed 200-request
identity isolation. No Cloudflare account is used.
