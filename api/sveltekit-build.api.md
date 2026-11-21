# @serverless-jwt/sveltekit/build

Generated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.

## build.d.mts

```ts
import { Adapter } from '@sveltejs/kit';
/**
 * One registered policy binds runtime decisions to the adapter's production artifact checks.
 */
export interface JwtAdapterOptions {
  /**
   * Patterns describe deployment paths including any base; predicates explicitly waive static
   * analysis.
   */
  readonly protect: ReadonlyArray<string> | 'predicate';
}
/**
 * Wraps a real adapter; protected static output is rejected before its adapt method can run.
 */
export declare function serverlessJwtAdapter(adapter: Adapter, options: JwtAdapterOptions): Adapter;
```
