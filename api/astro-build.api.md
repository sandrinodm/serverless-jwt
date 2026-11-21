# @serverless-jwt/astro/build

Generated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.

## build.d.mts

```ts
import { AstroIntegration } from 'astro';
/**
 * Build registration explicitly distinguishes patterns from unanalysable predicates.
 */
export interface AstroJwtOptions {
  /**
   * Deployment paths include the configured base; predicates require explicit registration.
   */
  readonly protect: ReadonlyArray<string> | 'predicate';
}
/**
 * Binds the real runtime policy to supported Astro/Vite hooks and checks native prerender metadata.
 */
export declare function serverlessJwt(options: AstroJwtOptions): AstroIntegration;
```
