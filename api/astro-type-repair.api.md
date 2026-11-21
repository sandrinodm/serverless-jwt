# @serverless-jwt/astro/type-repair

Generated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.

## type-repair.d.mts

```ts
/**
 * Selects an explicit consumer installation and optional read-only verification.
 */
export interface AstroTypeRepairOptions {
  /**
   * Directory containing the application's package.json; defaults to the working directory.
   */
  readonly root?: string;
  /**
   * Writable project installation boundary; workspace apps explicitly select their workspace root.
   */
  readonly installationRoot?: string;
  /**
   * Verifies that every repair is present without modifying the installation.
   */
  readonly check?: boolean;
}
/**
 * Reports the exact supported SDK and the number of declarations replaced.
 */
export interface AstroTypeRepairResult {
  /**
   * Exact Astro release whose published file inventory was verified.
   */
  readonly version: string;
  /**
   * Number of declaration files replaced by this invocation.
   */
  readonly changed: number;
}
/**
 * Explicitly repairs the audited Astro declaration graph without changing runtime files. Run this
 * after dependency installation; package imports never invoke it automatically.
 */
export declare function repairAstroTypes(options?: AstroTypeRepairOptions): AstroTypeRepairResult;
```
