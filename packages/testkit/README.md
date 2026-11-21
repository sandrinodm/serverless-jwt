# Private conformance testkit

This workspace package provides synthetic signing keys, a test-only certificate authority and a local HTTPS issuer. Use these fixtures only in tests.

Run `pnpm exec vp test run --project @serverless-jwt/testkit` to exercise the core and adapter regression drivers. The [scenario definitions](src/scenarios/index.ts) specify the expected outcomes.
