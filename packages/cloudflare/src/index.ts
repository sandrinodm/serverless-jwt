import type {
  EventContext,
  ExecutionContext,
  ExportedHandlerFetchHandler,
  PagesFunction,
  Request as WorkerRequest,
  Response as WorkerResponse,
} from '@cloudflare/workers-types';
import type { Auth, JwtVerifierError, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type {
  Guard,
  IntegrationOptions,
  RequestInfoLike,
} from '@serverless-jwt/jwt-verifier/adapter';

import {
  ConfigurationError,
  JwtVerifierError as AuthContextError,
} from '@serverless-jwt/jwt-verifier';
import {
  authorizationFromHeaders,
  createGuard,
  toResponse,
} from '@serverless-jwt/jwt-verifier/adapter';

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
> = IntegrationOptions<TIdentity> & { readonly mode?: TMode; readonly skip?: TSkip };

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
) => Response | WorkerResponse | Promise<Response | WorkerResponse>;

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
    request: WorkerRequest,
    env: TEnv,
    ctx: ExecutionContext,
  ) => Response | WorkerResponse | undefined | Promise<Response | WorkerResponse | undefined>;
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
export function getAuth<TIdentity = VerifiedClaims>(data: JwtData): Auth<TIdentity> {
  if (!data.auth) {
    throw new AuthContextError('auth_context_missing');
  }

  return data.auth as Auth<TIdentity>;
}

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
  ) => Response | WorkerResponse | undefined | Promise<Response | WorkerResponse | undefined>;
};

/**
 * Canonicalizes complete resolved configuration with stable function and opaque-object identities.
 */
function configurationKeyer(): (value: unknown) => string {
  const identities = new WeakMap<object, number>();
  let nextIdentity = 0;
  /**
   * Gives extension functions and opaque policy objects stable per-factory identities.
   */
  const identity = (value: object): number => {
    let key = identities.get(value);
    if (key === undefined) {
      key = ++nextIdentity;
      identities.set(value, key);
    }

    return key;
  };
  /**
   * Retains array order, property presence and scalar types without serializing function source.
   */
  const encode = (value: unknown, ancestors: Set<object>): string => {
    if (value === null) {
      return 'null';
    }

    if (typeof value === 'function') {
      return 'function:' + identity(value);
    }

    if (typeof value !== 'object') {
      if (typeof value === 'symbol' || typeof value === 'bigint') {
        throw new ConfigurationError('invalid_options');
      }

      return typeof value + ':' + String(JSON.stringify(value));
    }

    if (ancestors.has(value)) {
      throw new ConfigurationError('invalid_options');
    }

    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      return 'object:' + identity(value);
    }

    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        return (
          '[' + Array.from(value, (entry: unknown) => encode(entry, ancestors)).join(',') + ']'
        );
      }

      return (
        '{' +
        Object.keys(value)
          .sort()
          .map(
            (key) =>
              JSON.stringify(key) +
              ':' +
              encode((value as Record<string, unknown>)[key], ancestors),
          )
          .join(',') +
        '}'
      );
    } finally {
      ancestors.delete(value);
    }
  };
  return (value: unknown): string => encode(value, new Set());
}

/**
 * Static options create exactly one guard; env resolvers use a bounded eight-policy LRU.
 */
function guardResolver<
  TIdentity,
  TEnv,
  TMode extends Mode,
  TSkip extends Skip,
  TOptions extends CloudflareOptions<TIdentity, TMode, TSkip>,
>(
  options: TOptions | ((env: TEnv) => TOptions),
): (env: TEnv) => { readonly guard: Guard<TIdentity, TMode>; readonly options: TOptions } {
  if (typeof options !== 'function') {
    const guard = createGuard<TIdentity, TMode>(options);
    const captured = Object.freeze({ ...options }) as unknown as TOptions;
    return (): { readonly guard: Guard<TIdentity, TMode>; readonly options: TOptions } => ({
      guard,
      options: captured,
    });
  }

  const keyFor = configurationKeyer();
  const cache = new Map<
    string,
    { readonly guard: Guard<TIdentity, TMode>; readonly options: TOptions }
  >();
  return (env: TEnv): { readonly guard: Guard<TIdentity, TMode>; readonly options: TOptions } => {
    const resolved = Object.freeze({ ...options(env) }) as TOptions;
    const key = keyFor(resolved);
    let entry = cache.get(key);
    if (entry) {
      cache.delete(key);
    } else {
      entry = { guard: createGuard<TIdentity, TMode>(resolved), options: resolved };
    }

    cache.set(key, entry);
    if (cache.size > 8) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) {
        cache.delete(oldest);
      }
    }

    return entry;
  };
}

/**
 * Builds the portable guard view from Cloudflare's real Fetch request without consuming its body.
 */
function requestInfo(request: WorkerRequest): RequestInfoLike {
  return {
    method: request.method,
    url: request.url,
    authorization: authorizationFromHeaders(request.headers as unknown as Headers),
    header: (name: string): string | undefined => request.headers.get(name) ?? undefined,
  };
}

/**
 * Recognizes committed or locked bodies before accepting a custom error response.
 */
function usableResponse(response: unknown): response is Response {
  return response instanceof Response && !response.bodyUsed && !response.body?.locked;
}

/**
 * Protects a Workers module fetch handler; create once at module scope, never per request.
 */
export function withJwt<
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
export function withJwt<
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
 * Implements both skip-aware public overloads with the same request-owned decision path.
 */
export function withJwt<
  TIdentity = VerifiedClaims,
  TEnv = unknown,
  TMode extends Mode = 'required',
>(
  options:
    | WorkerOptions<TIdentity, TEnv, TMode, Skip>
    | ((env: TEnv) => WorkerOptions<TIdentity, TEnv, TMode, Skip>),
  handler:
    | JwtWorkerHandler<TIdentity, TEnv, TMode>
    | JwtWorkerHandler<TIdentity, TEnv, TMode, Skip>,
): ExportedHandlerFetchHandler<TEnv> {
  const resolve = guardResolver<
    TIdentity,
    TEnv,
    TMode,
    Skip,
    WorkerOptions<TIdentity, TEnv, TMode, Skip>
  >(options);
  return async (request, env, ctx): Promise<WorkerResponse> => {
    const { guard, options: resolved } = resolve(env);
    const decision = await guard.decide(
      requestInfo(request),
      request.signal as unknown as AbortSignal,
    );
    if (decision.kind === 'reject') {
      if (resolved.onError) {
        try {
          const response = await resolved.onError(decision.error, request, env, ctx);
          if (response !== undefined) {
            if (!usableResponse(response)) {
              throw new Error('Unusable custom response');
            }

            return response as unknown as WorkerResponse;
          }
        } catch {
          guard.reportErrorHookFailure();
        }
      }

      return toResponse(decision.http) as unknown as WorkerResponse;
    }

    return (handler as JwtWorkerHandler<TIdentity, TEnv, TMode, Skip>)(
      request,
      env,
      ctx,
      (decision.kind === 'skip' ? undefined : decision.auth) as CloudflareAuth<
        TIdentity,
        TMode,
        Skip
      >,
    ) as Promise<WorkerResponse>;
  };
}

/**
 * Protects Pages Functions and places auth only on the current context.data before next().
 */
export function jwtMiddleware<
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
): PagesFunction<TEnv, TParams, TData> {
  const resolve = guardResolver<
    TIdentity,
    TEnv,
    TMode,
    TSkip,
    PagesOptions<TIdentity, TEnv, TParams, TData, TMode, TSkip>
  >(options);
  return async (context): Promise<WorkerResponse> => {
    const { guard, options: resolved } = resolve(context.env);
    context.data.auth = undefined;
    const decision = await guard.decide(
      requestInfo(context.request),
      context.request.signal as unknown as AbortSignal,
    );
    if (decision.kind === 'reject') {
      if (resolved.onError) {
        try {
          const response = await resolved.onError(decision.error, context);
          if (response !== undefined) {
            if (!usableResponse(response)) {
              throw new Error('Unusable custom response');
            }

            return response as unknown as WorkerResponse;
          }
        } catch {
          guard.reportErrorHookFailure();
        }
      }

      return toResponse(decision.http) as unknown as WorkerResponse;
    }

    context.data.auth = decision.kind === 'skip' ? undefined : decision.auth;
    return context.next();
  };
}
