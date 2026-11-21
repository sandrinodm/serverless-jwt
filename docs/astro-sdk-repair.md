# Astro SDK declaration repair

Astro 7.4.5 needs an explicit declaration repair before strict TypeScript checking.
Use the `@serverless-jwt/astro/type-repair` entry for this exact SDK. This is a required consumer installation step, including when
lifecycle scripts are disabled. See the [installation commands](../packages/astro/README.md).

## Installation contract

Install the exact advertised type peers, then run from the application directory:

```sh
node --input-type=module -e "import { repairAstroTypes } from '@serverless-jwt/astro/type-repair'; repairAstroTypes()"
```

For a workspace app, pass `installationRoot` explicitly when the workspace owns
node_modules. `root` selects the application's package.json; it defaults to the
working directory. `check: true` verifies a completed repair without writing.
Imports never run the repair. Reinstallation requires repeating the command.

The repair verifies the complete recorded Astro, unstorage and markdown package
inventories, all shipped payload hashes, exact versions and real package locations
before writing. The selected SDK, type peers and invoking package must belong to
the explicit installation. Unexpected source bytes, versions, peer identities or
out-of-boundary paths fail. Declaration replacements use new sibling files and
rename, preserving package-manager store hardlinks. Runtime JavaScript remains
unchanged. The installation must be writable; an untouched install alone is not
the supported strict-type workflow.

The exact type peers are @astrojs/markdown-remark 7.3.5, @types/node 26.6.6,
@types/unist 3.0.3, @types/hast 3.0.5, @types/mdast 4.0.4, mongodb 7.8.0 and
ioredis 5.11.1. They are optional peer metadata for runtime-only installations,
but required by this strict-type workflow. TypeScript 7.0.2 remains the checker.
The repair adds no verifier or adapter runtime dependencies.

## Declaration changes and provenance

The [manifest](../packages/astro/type-repair/manifest.json) records original file
hashes and replacement hashes. The [provenance](../packages/astro/type-repair/provenance.json)
distinguishes exact upstream declarations from derived repairs. Generator inputs,
source references and full applicable licenses ship beside the payloads. Archived
`generator/generate.mjs.txt`, `trim.mjs.txt`, `package.json.txt` and
`package-lock.json.txt` retain original bytes. In a disposable generator directory,
remove the final `.txt` suffix from all four files together before installing the
generator dependencies or executing generation. These archived inputs remain
provenance evidence in the published integration.

- Restore source-defined AstroAdapterClientConfig and ContextProvider, omitted by
  the upstream stripInternal build despite public references.
- Extract actual storage-driver option declarations without importing unrelated
  runtime client graphs. MongoDB and Redis retain their genuine installed nominal
  classes. The options companion lives beside unstorage, so its LRU dependency
  retains the original owner and resolver-specific declarations.
- Preserve Astro's legacy compiler API types with the source-exact TypeScript 6.0.3
  declaration file and its notices. No TypeScript 6 compiler is shipped or selected.
- Correct ambient declarations and virtual manifest exports to match the actual
  framework runtime. Component companions retain source Props and the real
  AstroComponentFactory callable intersection and metadata.
- Define the missing KebabKeys mapping as a derived source repair; no original
  upstream definition existed. CSS key and vendor-prefix negative checks cover it.
- Make initial and generated content declarations merge without duplicate aliases,
  preserving generated collection inference, original type helpers and Render.
  Four result-only live-data generic bounds now allow schema transforms that
  actually return scalars. Input loader constraints and all result fields remain.
- Redirect four markdown declaration imports to the genuine AST type peers. Merely
  adding app-level peers did not make them visible in a pnpm installation with
  hoisting and automatic peer installation disabled.

Thirteen Astro declarations and four markdown declarations are replaced; one
unstorage options companion is added. Shipped adapter assets remain immutable.
The new repair entry is separate from the existing runtime and build entries.
