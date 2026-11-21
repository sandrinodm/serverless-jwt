---
name: new-integration
description: Add or change an official serverless-jwt framework integration, including its platform wrappers, conformance registration, peer range and tested example app.
---

Read `CLAUDE.md`, `docs/integration-author.md`, and the README of the closest existing integration before editing.
The toolkit contract is `packages/jwt-verifier/src/adapter.ts`. Reuse its extraction and
guard decisions; keep framework imports out of core.

Create one verifier per factory. Preserve every platform argument and store auth only on
request-owned state. Default to required authentication, including OPTIONS. Optional missing
auth is null; explicit skip is undefined. Call the handler outside authentication catches.
Await the framework's typed onError and use its default response only before commitment.
Report hook failure through `guard.reportErrorHookFailure()`; offer the adapter-owned
`onIntegrationDiagnostic` callback even when a verifier was supplied.

Register every public form separately with `defineConformanceSuite`. Only duplicate-header
preservation and streaming transport gaps may skip, with a reason and lost guarantee.
Use real framework request/response objects; include typed identity propagation and wrapper
assignability tests. Global declaration merging uses `Auth<unknown> | null | undefined`
plus a checked accessor; never promise per-factory global types.

Add the complete tested example under `e2e/apps/<integration>` and its real HTTP contract.
Run `pnpm test:peers <integration> min` and `max`, which install into disposable copies.
Document supported versions and transport limits in the package README and compatibility guide. Keep
strict seven-day release age. Run focused conformance/types, `pnpm ready`, API reports and
packed-package checks. Publication and repository writes follow the user's current scope;
this skill grants no additional authorization.
