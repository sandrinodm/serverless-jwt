# Contributor guidance

Run `pnpm ready` before finishing changes and `pnpm test:package` after packing.
Use `pnpm exec vp check --fix` for formatting and `pnpm exec vp test` for focused tests.
Read [development](docs/development.md) for toolchain setup and packaging commands.

Packages live in `packages/<integration>`; the portable core is `packages/jwt-verifier`.
Use relative `.ts` imports, explicit return types, readonly fields and `ReadonlyArray<T>`.
Document top-level declarations with multiline JSDoc explaining purpose.
Keep blank lines after control-flow blocks.
Never log from library code. Never put token contents in an error message.

Every commit uses `type(scope): lowercase imperative subject`, followed by a blank line
and a body explaining why. Allowed types: feat, fix, docs, style, refactor, perf, test,
build, ci, chore, revert. Scope is optional; add `!` for breaking changes.
