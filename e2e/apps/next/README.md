# Next App Router and proxy example

Build public libraries, then run pnpm --dir e2e/apps/next build:app before pnpm test:e2e.
Set ISSUER and optionally JWKS_URI at runtime. The API audience is https://resource.example.

The production app has a route-only endpoint at /direct/me/[id], plus early proxy rejection
and independently authenticated routing at /api/me/[id]. Both use the actual NextRequest
and promised params. Spoofed x-auth-sub headers are ignored for identity.

The actual Next16 Turbopack production build and runtime use TypeScript 7. The nightly
Next dev smoke also runs Turbopack and verified HTTPS fixture authentication. All local
processes use explicit telemetry-off and isolated configuration. No platform account is used.
