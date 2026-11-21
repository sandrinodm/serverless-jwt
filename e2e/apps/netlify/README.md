# Netlify Functions v2 and Edge example

Build public libraries, then run pnpm --dir e2e/apps/netlify build:app. The real pinned
CLI executes build --offline and bundles both platform functions. HTTP contracts run
actual dev --offline with no account, login, linking, or credential environment.

The runner copies this complete site to a disposable directory, preserving actual built
public dependency resolution. This avoids ancestor workspace lockfiles changing Netlify's
base/publish/functions paths. Explicit static build settings avoid unrelated monorepo
framework detection. CLI configuration and cache state are isolated.

Set DENO_BIN to the verified Deno executable. Edge gets DENO_CERT and DENO_DIR exclusively
from a private temporary .env; duplicating them in the parent environment prevents the
CLI from forwarding them. Functions uses NODE_EXTRA_CA_CERTS. TLS verification remains on.

The real CLI supplies original Request and Context in each host. Both local ingress paths
have the documented separate-wire Authorization preservation gap; joined credentials,
forged preflights, invalid tokens and unavailable keys retain mandatory rejection behavior.
