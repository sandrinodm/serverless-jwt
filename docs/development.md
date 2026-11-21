# Development

Use Node 26 and pnpm 12.17.0 for this workspace. Public packages support Node 24.0.0 and later. Install the locked dependencies and build the core before running workspace checks. Integration test configurations import its package exports during discovery.

```sh
pnpm install --frozen-lockfile
pnpm --dir packages/jwt-verifier exec vp pack
pnpm ready
```

## Testing changes

`pnpm ready` runs formatting, linting, type checks and the unit and conformance tests. To run one package, use `pnpm exec vp test run --project @serverless-jwt/jwt-verifier`.

| Change                        | Checks                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------ |
| Public API or package exports | `pnpm build`, `pnpm api:check`, package smoke                                  |
| Verification behavior         | `pnpm test:coverage`                                                           |
| Framework integration         | `pnpm conformance:check`, `pnpm test:e2e`                                      |
| Documentation                 | `pnpm docs:reference --check`, `pnpm docs:packages --check`, `pnpm docs:links` |

Regenerate the relevant documentation with `pnpm docs:reference` or `pnpm docs:packages`. The link check uses lychee 0.24.2. Set `LYCHEE_BIN` to its executable if it is outside your path.

## Checking published artifacts

Build and pack all public workspaces into an empty directory. Set `MIN_NODE_BIN` to the Node 24.0.0 executable and `DENO_BIN` to the pinned Deno executable used in CI.

```sh
pnpm build
pnpm pack:public artifacts
pnpm test:package artifacts
pnpm docs:examples artifacts
```

The smoke test installs the tarballs into isolated consumers and checks entry points and declarations. The documentation examples also install these tarballs. See the [release procedure](releasing.md) for promotion and registry checks.

## End-to-end tests

Run `pnpm build:e2e` and `pnpm test:e2e` for the PR matrix. Use `E2E_INTEGRATION` to select one integration. The Hono runtime checks use `MIN_NODE_BIN`, `DENO_BIN` and `BUN_BIN`. To run application tests against packed releases, use `pnpm test:e2e:release artifacts`. The [capability matrix](../e2e/matrix.ts) defines which host and application serve each route.

Nightly tests also require Docker, OpenSSL and the pinned Python tools in the [nightly workflow](../.github/workflows/nightly.yml). Set `E2E_PYTHON` to that environment’s interpreter. Container versions and digests are in the [image manifest](../e2e/images.json).

The Floci200 check provisions 200 concurrent Lambda invocations in the Floci AWS emulator. Its required CI job uses a separate Linux x64 GitHub-hosted runner with at least 16 cores and 64 GB of memory. Configure `FLOCI_NIGHTLY_RUNNER_GROUP` for an ephemeral hosted group without private-network access and `FLOCI_NIGHTLY_RUNNER` for its runner label. Missing settings fail the required check. Preflight checks also verify Docker capacity and available kernel keyring slots.

See the [integration author guide](integration-author.md) for package layout, platform contracts and example applications.
