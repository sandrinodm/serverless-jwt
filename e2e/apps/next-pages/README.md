# Next Pages API example

This complete production app uses `@serverless-jwt/next/pages` at `/api/protected` and a public `/ready` route. Run `pnpm build` and `pnpm --dir e2e/apps/next-pages build:app` before the shared HTTP contract. The actual `next start` process runs on Node 24.0.0 against trusted HTTPS OIDC, verifies 200 distinct client identities in two rounds, and rejects both literal raw-TCP duplicate orders. It has no App Router proxy in front of the Pages route, so the adapter receives the original Node header representation.
