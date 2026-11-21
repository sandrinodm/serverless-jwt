# SolidStart native host

This is an actual `@solidjs/start` 2 application. Its Vite Environment API client
and server builds use `solidStart()` followed by the documented Nitro 3 deployment
plugin. Native H3 v2 middleware calls `@serverless-jwt/nuxt/h3-v2` with its unchanged
event. Native method exports read `APIEvent.nativeEvent` with `getAuth`.

Run `pnpm --dir e2e/apps/solidstart build:app`, then
`E2E_INTEGRATION=nuxt E2E_APPLICATION=solidstart pnpm test:e2e:nightly`.
Its independent nightly security row runs the complete 200 cold/warm isolation,
credential, CORS, duplicate-header, streaming and real-clock security contract.

Before pinning, `npm view @solidjs/start version time dependencies peerDependencies
--json` verified 2.2.1 (2026-11-03); 2.2.2 (2026-11-07) is too young. `npm view
@solidjs/router version time --json` selected stable 1.0.1 (2026-10-30), excluding
1.0.2/1.0.3. Strict 10080-minute release age remains enabled. Other pins already
exist in the accepted catalog and native H3 v2 fixture.

Primary API evidence: [v2 setup](https://docs.solidjs.com/solid-start/v2/getting-started)
and [Nitro deployment](https://docs.solidjs.com/solid-start/v2/guides/deployment-plugins).
The exact 2.2.1 npm tarball's `dist/middleware/index.d.ts` and `.js` confirm the
public `createMiddleware(Middleware[])` form preserves H3 events; its
`dist/server/types.d.ts` declares the real `APIEvent.nativeEvent: H3Event`.
Native build and TypeScript 7 use these public SDK declarations without stubs.

Local validation on 2026-11-12: the actual Vite client/server/Nitro production
build and full HTTP security row pass under Node 24.0.0. An initial real HTTP
failure caught lost CORS headers on guard rejections; decorating that returned
Response with app CORS makes the unchanged contract pass. A deliberately missing
native route import fails the real builder; exact source restoration builds again.

On 2026-11-13 the complete ordinary `build:app` gate passes with the
[six-line pinned SDK declaration repair](../../../docs/solidstart-sdk-repair.md).
The private development/fixture graph corrects optional-property unions already
accepted by real SDK derived types and runtime. Exact version/byte guards also
apply the same repair in npm-staged exact-tarball apps. Actual SDK runtime bytes,
`strict`, `skipLibCheck: false` and exact optional properties are unchanged; real
SDK positive/negative checks, native production build and full Node24 cold200/warm200
HTTP security row pass. Ordinary public npm consumers remain unpatched. Earlier
red diagnostics and rejected Start1/Vinxi evidence remain separately documented.
`ESNext.Error` supplies the actual native `Error.isError` type. Native app types
include `src` and actual framework SDKs; the native builder owns its Vite config.
