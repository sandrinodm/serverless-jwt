# Plain Nitro native host

This independent Nitro 2 project builds with `nitro build` and serves its generated
`.output/server/index.mjs` under Node 24. It imports the existing
`@serverless-jwt/nuxt` root entrypoint against real H3 v1 events; Nuxt is absent.

Run `pnpm --dir e2e/apps/nitro build:app`, then
`E2E_INTEGRATION=nuxt E2E_APPLICATION=nitro pnpm test:e2e:nightly`.
The registered nightly security row includes 200 concurrent cold and warm subjects,
raw duplicate credentials in both orders, cookie/query rejection, default forged
OPTIONS, application CORS before authentication, streaming and real expiry clocks.

Nitropack 2.13.6 (2026-11-02) was checked using `npm view nitropack version time
peerDependencies --json` before pinning. It meets the unchanged 10080-minute age
policy. H3 1.15.11 is the already-verified Nuxt fixture pin. Native source in
`nitropack/dist/config` confirms `defineNitroConfig`; its `srcDir: server` scans
real middleware and routes. No framework shim or compiler substitution is used.

Local validation on 2026-11-12: native `build:app` and strict TS7 runtime source
check pass. The independent nightly HTTP row passes against Node 24.0.0 and a
trusted HTTPS issuer. Deliberately assigning a string to a native route's number
binding fails TS2322; restoring exact source bytes makes build/types pass again.
The app typecheck includes native server sources and real H3 declarations;
Nitro's builder owns the deployment configuration.
