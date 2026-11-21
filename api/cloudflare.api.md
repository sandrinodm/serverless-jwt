# @serverless-jwt/cloudflare

Generated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.

## index.d.mts

```ts
import {
  EventContext,
  ExecutionContext,
  ExportedHandlerFetchHandler,
  PagesFunction,
  Request,
  Response as Response$1,
} from '@cloudflare/workers-types';
import { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import { IntegrationOptions, RequestInfoLike } from '@serverless-jwt/jwt-verifier/adapter';
/**
 * Authentication modes preserve required and optional handler inference.
 */
type Mode = 'required' | 'optional';
/**
 * An explicit synchronous skip adds undefined to handler auth.
 */
type Skip = ((request: RequestInfoLike) => boolean) | undefined;
/**
 * Request-owned authentication, including only the states enabled by the factory.
 */
export type CloudflareAuth<
  TIdentity,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> =
  | Auth<TIdentity>
  | (TMode extends 'optional' ? null : never)
  | (TSkip extends undefined ? never : undefined);
/**
 * Shared Workers and Pages policy; construct factories once at module scope.
 */
export type CloudflareOptions<
  TIdentity = VerifiedClaims,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = IntegrationOptions<TIdentity> & {
  readonly mode?: TMode;
  readonly skip?: TSkip;
};
/**
 * Workers callback receives every original platform argument followed by request-owned auth.
 */
export type JwtWorkerHandler<
  TIdentity,
  TEnv,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = (
  request: Parameters<ExportedHandlerFetchHandler<TEnv>>[0],
  env: TEnv,
  ctx: ExecutionContext,
  auth: CloudflareAuth<TIdentity, TMode, TSkip>,
) => Response | Response$1 | Promise<Response | Response$1>;
/**
 * Workers options own a typed asynchronous error hook without catching application failures.
 */
export type WorkerOptions<
  TIdentity,
  TEnv,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = CloudflareOptions<TIdentity, TMode, TSkip> & {
  /**
   * Undefined selects the safe default; custom responses should retain no-store.
   */
  readonly onError?: (
    error: JwtVerifierError,
    request: Request,
    env: TEnv,
    ctx: ExecutionContext,
  ) => Response | Response$1 | undefined | Promise<Response | Response$1 | undefined>;
};
/**
 * Pages data cannot promise a different global identity type for each middleware factory.
 */
export interface JwtData extends Record<string, unknown> {
  /**
   * Missing for unguarded or skipped requests, null for optional missing credentials.
   */
  auth?: Auth<unknown> | null | undefined;
}
/**
 * Reads required Pages auth with an app-selected identity type; unguarded paths fail closed.
 */
export declare function getAuth<TIdentity = VerifiedClaims>(data: JwtData): Auth<TIdentity>;
/**
 * Pages options keep the real event context available to custom rejection hooks.
 */
export type PagesOptions<
  TIdentity,
  TEnv,
  TParams extends string,
  TData extends JwtData,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
> = CloudflareOptions<TIdentity, TMode, TSkip> & {
  /**
   * Undefined selects the default rejection; hook failures emit a fixed diagnostic.
   */
  readonly onError?: (
    error: JwtVerifierError,
    context: EventContext<TEnv, TParams, TData>,
  ) => Response | Response$1 | undefined | Promise<Response | Response$1 | undefined>;
};
/**
 * Protects a Workers module fetch handler; create once at module scope, never per request.
 */
export declare function withJwt<
  TIdentity = VerifiedClaims,
  TEnv = unknown,
  TMode extends Mode = 'required',
>(
  options:
    | (WorkerOptions<TIdentity, TEnv, TMode, (request: RequestInfoLike) => boolean> & {
        readonly skip: (request: RequestInfoLike) => boolean;
      })
    | ((env: TEnv) => WorkerOptions<
        TIdentity,
        TEnv,
        TMode,
        (request: RequestInfoLike) => boolean
      > & {
        readonly skip: (request: RequestInfoLike) => boolean;
      }),
  handler: JwtWorkerHandler<TIdentity, TEnv, TMode, (request: RequestInfoLike) => boolean>,
): ExportedHandlerFetchHandler<TEnv>;
/**
 * Required-by-default overload keeps auth nonnullable when no explicit skip is supplied.
 */
export declare function withJwt<
  TIdentity = VerifiedClaims,
  TEnv = unknown,
  TMode extends Mode = 'required',
>(
  options:
    | WorkerOptions<TIdentity, TEnv, TMode>
    | ((env: TEnv) => WorkerOptions<TIdentity, TEnv, TMode>),
  handler: JwtWorkerHandler<TIdentity, TEnv, TMode>,
): ExportedHandlerFetchHandler<TEnv>;
/**
 * Protects Pages Functions and places auth only on the current context.data before next().
 */
export declare function jwtMiddleware<
  TIdentity = VerifiedClaims,
  TEnv = unknown,
  TParams extends string = string,
  TData extends JwtData = JwtData,
  TMode extends Mode = 'required',
  TSkip extends Skip = undefined,
>(
  options:
    | PagesOptions<TIdentity, TEnv, TParams, TData, TMode, TSkip>
    | ((env: TEnv) => PagesOptions<TIdentity, TEnv, TParams, TData, TMode, TSkip>),
): PagesFunction<TEnv, TParams, TData>;
export {};
```
