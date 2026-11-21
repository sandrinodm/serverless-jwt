# SolidStart SDK declarations

The SolidStart fixture uses exact optional property types. Two SDK interfaces omit the explicit `undefined` accepted by their derived types. The workspace [patches](../patches) update six declaration properties.

| SDK                     | Declaration change                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `@solidjs/router@1.0.1` | Allow explicit `undefined` for `AnchorHTMLAttributes.noScroll` and `replace`, matching `AnchorProps`.                                   |
| `h3@2.0.8`              | Allow explicit `undefined` for `ErrorBody.statusText`, `unhandled`, `data` and `body`, matching the properties assigned by `HTTPError`. |

pnpm applies the patches during workspace installation. The [staging helper](../scripts/solidstart-sdk.ts) applies the same changes to isolated SolidStart test applications and checks the installed versions and file hashes against the [manifest](../e2e/solidstart-sdk-patch.json). Public package consumers receive the upstream declarations.

When upgrading either SDK, check whether its own declarations now satisfy the fixture, then update or retire the corresponding patch and manifest entry. Run the strict app type check and the patch checks.

```sh
pnpm --dir e2e/apps/solidstart test:types
pnpm exec vp test run scripts/solidstart-sdk.test.mjs
```
