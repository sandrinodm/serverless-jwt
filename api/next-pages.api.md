# @serverless-jwt/next/pages

Generated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.

## pages.d.mts

```ts
import { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
/// <reference path="./next-compat.d.ts" />
/// <reference path="./sharp-compat.d.cts" />
/// <reference lib="es2024.promise" />
import { IntegrationOptions, RequestInfoLike } from '@serverless-jwt/jwt-verifier/adapter';
import { NextApiRequest, NextApiResponse } from 'next';
/**
 * Missing-credential state follows the factory's mode.
 */
type Mode = 'required' | 'optional';
/**
 * Undefined authentication is possible only with an explicit skip.
 */
type Skip = ((request: RequestInfoLike) => boolean) | undefined;
/**
 * Pages handlers receive only the authentication states enabled by their policy.
 */
export type PagesAuth<TIdentity, TMode extends Mode = 'required', TSkip extends Skip = undefined> =
  | Auth<TIdentity>
  | (TMode extends 'optional' ? null : never)
  | (TSkip extends undefined ? never : undefined);
/**
 * Pages rejection hooks receive the original mutable platform response.
 */
export type PagesOptions<
  TIdentity = VerifiedClaims,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = IntegrationOptions<TIdentity> & {
  /**
   * Required by default; optional missing credentials produce null.
   */
  readonly mode?: TMode;
  /**
   * Explicitly permits unauthenticated access for matching request views.
   */
  readonly skip?: TSkip;
  /**
   * May finish the response; undefined selects the default before commitment.
   */
  readonly onError?: (
    error: JwtVerifierError,
    request: NextApiRequest,
    response: NextApiResponse,
  ) => void | Promise<void>;
};
/**
 * Explicit skip handlers receive undefined for deliberately unguarded requests.
 */
export declare function withJwtPages<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: PagesOptions<TIdentity, TMode, (request: RequestInfoLike) => boolean> & {
    readonly skip: (request: RequestInfoLike) => boolean;
  },
  handler: (
    request: NextApiRequest,
    response: NextApiResponse,
    auth: PagesAuth<TIdentity, TMode, (request: RequestInfoLike) => boolean>,
  ) => void | Promise<void>,
): (event: NextApiRequest, context: NextApiResponse) => Promise<void>;
/**
 * Required handlers retain nonnullable Auth unless optional mode is selected.
 */
export declare function withJwtPages<TIdentity = VerifiedClaims, TMode extends Mode = 'required'>(
  options: PagesOptions<TIdentity, TMode, undefined>,
  handler: (
    request: NextApiRequest,
    response: NextApiResponse,
    auth: PagesAuth<TIdentity, TMode, undefined>,
  ) => void | Promise<void>,
): (event: NextApiRequest, context: NextApiResponse) => Promise<void>;
/**
 * Broad pretyped policies preserve all authentication states enabled by the caller.
 */
export declare function withJwtPages<TIdentity = VerifiedClaims, TMode extends Mode = Mode>(
  options: PagesOptions<TIdentity, TMode, Skip>,
  handler: (
    request: NextApiRequest,
    response: NextApiResponse,
    auth: PagesAuth<TIdentity, TMode, Skip>,
  ) => void | Promise<void>,
): (event: NextApiRequest, context: NextApiResponse) => Promise<void>;
export {};
```

## next-compat.d.ts

```ts
/**
 * Resolves Next16.4.5's directory reference to its exact shipped Satori declaration.
 */
declare module 'next/dist/compiled/@vercel/og/satori' {
  export * from 'next/dist/compiled/@vercel/og/satori/index.js';
}
```

## sharp-compat.d.cts

```ts
import type sharp = require('sharp');
import type { SharpConstructor as ESMSharpConstructor } from 'sharp' with {
  'resolution-mode': 'import',
};

/**
 * Links Sharp0.35.5's missing CJS alias to the exact ESM interface from the same package.
 */
declare module 'sharp' {
  type SharpConstructor = ESMSharpConstructor;
}
```
