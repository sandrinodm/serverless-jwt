# Verify locally

[README](../../../README.md) · [Getting started](../../getting-started.md)

This standalone Node 24+ project uses only public `jose` and core APIs. It creates fresh RSA keys, binds its JWKS server and sample API to loopback, mints a short-lived token and calls the API. It asserts valid 200, missing 401 with the bare challenge, invalid 401, insufficient scope 403 and mapped identity. Tokens and private keys are never printed or saved.

## Run against an exact published version

Copy this directory outside the monorepo, then install an exact version. The 1.0 candidate has not been published as part of this implementation; set the version only after the maintainer publishes it.

```sh
: "${JWT_VERSION:?set an exact published version}"
cp -R docs/examples/verify-locally /tmp/serverless-jwt-verify-locally
cd /tmp/serverless-jwt-verify-locally
npm install --ignore-scripts --save-exact "@serverless-jwt/jwt-verifier@$JWT_VERSION"
npm test
```

## Run an exact packed candidate

From the repository, build and pack first, then run the isolated consumer gate:

```sh
pnpm --dir packages/jwt-verifier exec vp pack
pnpm pack:public /tmp/serverless-jwt-docs-artifacts
node scripts/docs-examples.mjs /tmp/serverless-jwt-docs-artifacts
```

The gate installs its own dependencies outside the workspace, applies the same strict seven-day release-age policy, checks the installed library version and executes this project. It accepts the actual tarball, not source conditions or private test helpers. It does not publish anything.

For your application, reproduce this loopback issuer arrangement in your local test harness and configure its issuer, JWKS endpoint and `urn:example:orders-api` audience before starting the application. The core example's server uses ephemeral ports. Optional `TARGET_URL` only accepts a loopback URL and sends the same valid token to a separately configured local application; set `ISSUER_PORT` to a known free loopback port and configure the external app with `http://127.0.0.1:<port>` and its `/jwks` endpoint before starting the check. It never sends tokens to hosted applications.

The HTTP loopback exception is explicit local test policy. Production endpoints require HTTPS. These disposable keys and tokens are not provider-issued; this example cannot verify hosted login or your provider configuration.
