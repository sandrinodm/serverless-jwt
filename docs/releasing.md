# Releasing serverless-jwt

[README](../README.md) · [Development](development.md)

All public packages share one version and one `vX.Y.Z` tag. Release candidates use
`X.Y.Z-rc.N` and only `next`; stable versions use `latest`. The public manifests in `packages/*/package.json` define the artifact inventory.

## Repository and registry setup

Verify the repository identity before changing any service: the original upstream URL now
redirects to `sandrinodm/serverless-jwt`, repository ID `281962945`, default branch `master`.
If ownership changes,
reverify the repository ID and every trusted-publisher identity; do not silently follow a new owner.

- [ ] Enable GitHub private vulnerability reporting and Dependabot security alerts.
- [ ] Require `ci-ok` on `master`, required review including CODEOWNERS, linear history/squash
      merges and no force pushes. Protect `v*` tags. PR titles are Conventional Commits.
- [ ] Create the `npm` environment with required reviewers, deployments limited to `v*` tags,
      and **no npm token or other secrets**. The build and authorize jobs do not use this environment.
- [ ] For each new npm name (all except `jwt-verifier`, `cloudflare`, `netlify`, `next`), have
      an authenticated maintainer publish a `0.0.0-placeholder` package with a README linking
      upstream, using `--tag bootstrap`. Record `npm view <name> dist-tags --json`; specifically
      record whether first publication assigns `latest` despite the requested tag. Deprecate
      that placeholder with a message directing RC users to `<name>@next`.
- [ ] Configure all fourteen npm trusted publishers for verified owner `sandrinodm`, repository
      `serverless-jwt`, workflow `publish.yml`, environment `npm`. Explicitly allow **direct npm
      publish**, rather than npm's default staged publishing. Require 2FA and disallow tokens.
- [ ] Complete the first OIDC publish within npm's two-day configuration expiry window. If it
      expires, recreate the publisher. Schedule configuration and the first RC together.
- [ ] Record `latest`, `next` and `bootstrap` for every package before the RC. New packages'
      `latest` may remain at the deprecated placeholder until stable `1.0.0`; npm requires a
      `latest` tag. RC publication must never set `latest` to the RC.
- [ ] Remove old Lerna automation tokens and obsolete release credentials.

npm 12.2+/11.21+ can optionally grant trusted publishers dist-tag permission. This project
keeps that permission disabled and retains manual maintainer dist-tag operations. Publisher
configuration is not exposed through a supported public preflight API; an OIDC 403 stops
publication and points here. Never add a token or `--force` to work around it.

## Prepare and rehearse

1. Run the release checks, including strict Astro packed types and the actual fourteen-package
   integration/runtime matrix. Inspect `pnpm ready`, frozen installation, audit, API reports,
   exact package smoke and the exact-artifact HTTP results. Do not waive a red gate.
2. Start with a clean tree. Run `pnpm version:set 1.0.0-rc.1`. The script changes only public
   versions and rejects noncanonical versions, unsupported prerelease channels and dirty trees.
   Keep every internal dependency `workspace:*`; packing resolves it to the shared version.
3. Write the root `CHANGELOG.md` entry by hand, with each affected package and a Security
   section. Prepare the Conventional Commit release commit, then let push-triggered `ci.yml`
   pass on `master` for that exact commit.
4. The maintainer creates `v1.0.0-rc.1` at that commit. Dispatch `publish.yml` **on that tag**
   with `dry-run: true` (the default). It builds without OIDC permission, tests exact tarballs,
   authorizes run origin and inventory, then checks the authorized archive SHA256 before
   extraction and every tarball SHA512. No npm command or registry write occurs in publish-all's
   dry run; registry post-publication verification is skipped.
5. A second person follows this document for an RC and records commands, run IDs, the fourteen
   artifact names/digests, environment approval, resulting versions/tags and provenance audit.
   This hosted rehearsal remains required even when local tooling tests pass.
6. Create the GitHub release on the same tag, marking an RC prerelease. Use the corresponding
   hand-written changelog section as the release body. Approve the protected environment only
   after inspecting source run, artifact IDs and digests. A dispatch with `dry-run: false` is
   also a publication and requires the same review.

## Publish and recover

`build` holds no publishing credentials. `authorize` runs on every attempt, including resume,
and repeats current tag/version/channel, master ancestry and successful push CI checks. It
requires the source run's repository/ID, publish workflow, exact commit and tag, allowed event,
successful build, unique live artifact and exact inventory. A checksum file alone never proves
artifact origin. The download action retains the raw archive; authorization's API SHA256 must
match before extraction. Only flat regular expected files and complete strict SHA512SUMS pass.

Only `publish` can request an OIDC token. It runs reviewed built-in-only tooling, obtains the
fixed-integrity bundled npm 12.2.1 distribution outside the checkout, and never installs the
project, runs tests or enables lifecycle scripts. npm runs in a fresh directory with inherited
tokens/configuration removed. It publishes the core first, then integrations alphabetically,
using `--access public --provenance --ignore-scripts --tag latest|next`. It cannot change other
dist-tags. Existing equal integrity is skipped; conflicting bytes or lookup errors stop the run.

If publication stops, keep the original artifacts. Dispatch the same tag with `resume-run-id`
set to the earlier **publish workflow** run and `dry-run: true` first. Review that authorization
still passes, then resume with `dry-run: false`. No rebuild happens on resume. Expired artifacts,
PR runs, foreign workflows/repositories/commits/tags, failed builds and incomplete inventories
are rejected. Do not use `--force`, a new build or a fresh version to conceal an integrity conflict.

After publishing, `verify-published.ts` checks every exact version's integrity, SLSA DSSE
subject SHA512, repository/workflow/tag/resolved commit and channel. It installs those exact
versions with scripts disabled into a fresh consumer and runs `npm audit signatures` for
cryptographic verification. Identity inspection alone does not verify signatures. After registry
verification, a release event or non-dry resume reconciles the tested tarballs and SHA512SUMS
with the GitHub release. It compares the downloaded bytes of every existing expected asset
before uploading missing assets. A same-name conflict fails without overwriting the release
asset. A manual dispatch can still publish a tag without a GitHub release. A resume sourced
from a release event requires that GitHub release to exist.

Before stable, finish the fourteen consecutive integrity-bound registry nights, real
deployments, independent human security review and second-person rehearsal. Record the
exact approved RC commit in repository variable `APPROVED_RC_COMMIT` as a forty-character
SHA. Both the unprivileged
build and resume authorization paths require it for stable publication and run:

```sh
: "${APPROVED_RC_COMMIT:?set the reviewed RC commit}"
: "${STABLE_COMMIT:?set the intended stable commit}"
pnpm release:diff "$APPROVED_RC_COMMIT" "$STABLE_COMMIT"
```

Only top-level version promotions and genuine documentation/changelog changes may pass.
Runtime/dependency/tooling changes require a new RC and restart the soak. Executable
projects under docs require a new candidate.

For stable `1.0.0`, publish under `latest`; inspect all fourteen tags. Revoke/recreate
expired trusted-publisher configurations as needed.
