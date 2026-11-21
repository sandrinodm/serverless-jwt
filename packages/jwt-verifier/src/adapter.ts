import type { VerifiedClaims } from './claims.ts';
import type { ErrorReason, HttpError } from './errors.ts';
import type { JwtVerifierOptions } from './options.ts';
import type { Auth, JwtVerifier } from './verify.ts';

import { getBearerToken } from './bearer.ts';
import { Deadline } from './deadline.ts';
import { ConfigurationError, JwtVerifierError, messages } from './errors.ts';
import { requireScopes, validateScopes } from './scopes.ts';
import { createJwtVerifier } from './verify.ts';

/**
 * Reads only own data properties, observing native rejected promises without invoking thenables.
 */
function errorData(value: unknown, ignoreStack = false): Record<string, unknown> {
  if (value instanceof Promise) {
    void Promise.prototype.then.call(value, undefined, () => {});
    throw new TypeError();
  }

  if (value === null || typeof value !== 'object') {
    throw new TypeError();
  }

  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (ignoreStack && key === 'stack') {
      continue;
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError();
    }

    result[key] = descriptor.value;
  }

  return result;
}

/**
 * Compares complete own data records without reading foreign getters or serialization hooks.
 */
function canonicalRecord(value: Record<string, unknown>, expected: object): boolean {
  const keys = Object.keys(expected);
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key) && value[key] === Reflect.get(expected, key))
  );
}

/**
 * Normalizes identical installed copies at the adapter boundary; only local errors reach output.
 */
function adapterError(cause: unknown): JwtVerifierError {
  try {
    if (cause instanceof JwtVerifierError) {
      // Call the native serializer before preserving the existing local error identity.
      JwtVerifierError.prototype.toHttp.call(cause);
      return cause;
    }

    if (!(cause instanceof Error)) {
      throw new TypeError();
    }

    const data = errorData(cause, true);
    const prototype = Object.getPrototypeOf(cause);
    const methods = errorData(prototype);
    if (
      Object.getPrototypeOf(prototype) !== Error.prototype ||
      Object.keys(methods).length !== 3 ||
      typeof methods.constructor !== 'function' ||
      Object.getPrototypeOf(methods.constructor) !== Error ||
      !['toHttp', 'toJSON'].every(
        (key) =>
          typeof methods[key] === 'function' &&
          Object.getPrototypeOf(methods[key]) === Function.prototype,
      ) ||
      data.name !== 'JwtVerifierError' ||
      typeof data.reason !== 'string' ||
      !Object.hasOwn(messages, data.reason) ||
      Object.keys(data).some(
        (key) => !['stack', 'cause', 'message', 'name', 'reason', 'code', 'status'].includes(key),
      )
    ) {
      throw new TypeError();
    }

    const reason = data.reason as ErrorReason;
    let local = new JwtVerifierError(reason);
    if (
      data.message !== local.message ||
      data.code !== local.code ||
      data.status !== local.status
    ) {
      throw new TypeError();
    }

    // Private retry state is available only through serialization. Treat its result as untrusted
    // input and derive a fresh local response; no foreign text, object, header or cause is retained.
    const candidate = errorData(Reflect.apply(methods.toHttp as () => unknown, cause, []));
    const body = errorData(candidate.body);
    const headers = errorData(candidate.headers);
    if (local.status === 503) {
      const retry = headers['retry-after'];
      if (typeof retry !== 'string' || !/^(?:[1-9]|[12][0-9]|30)$/.test(retry)) {
        throw new TypeError();
      }

      local = new JwtVerifierError(reason, { retryAfter: Number(retry) });
    }

    const expected = local.toHttp();
    if (
      !canonicalRecord(candidate, {
        status: expected.status,
        headers: candidate.headers,
        body: candidate.body,
      }) ||
      !canonicalRecord(body, expected.body) ||
      !canonicalRecord(headers, expected.headers)
    ) {
      throw new TypeError();
    }

    return local;
  } catch {
    return new JwtVerifierError('adapter_misconfigured');
  }
}

/**
 * Minimal platform request view for official integrations; fields may grow in minor releases.
 */
export interface RequestInfoLike {
  /**
   * Original request method.
   */
  readonly method: string;

  /**
   * Original request URL.
   */
  readonly url: string;

  /**
   * All authorization values in transport order, retaining duplicates.
   */
  readonly authorization: ReadonlyArray<string>;

  /**
   * Reads a named non-credential header without prescribing a platform representation.
   */
  readonly header: (name: string) => string | undefined;
}

/**
 * Authentication policy captured once when an integration factory is called at module scope.
 */
export interface GuardPolicy {
  /**
   * Missing credentials reject by default; optional mode supplies null instead.
   */
  readonly mode?: 'required' | 'optional';

  /**
   * Nonempty required scope set.
   */
  readonly scopes?: ReadonlyArray<string>;

  /**
   * Requires every configured scope by default.
   */
  readonly scopeMode?: 'all' | 'any';

  /**
   * Explicitly lets unauthenticated requests reach the handler with undefined auth.
   */
  readonly skip?: (request: RequestInfoLike) => boolean;

  /**
   * Adapter-owned observer, including with an existing verifier; never changes verifier policy.
   */
  readonly onIntegrationDiagnostic?: (event: IntegrationDiagnostic) => unknown;
}

/**
 * Fixed integration events never expose thrown values or platform request data.
 */
export interface IntegrationDiagnostic {
  /**
   * A custom response hook or caller-owned integration configuration failed.
   */
  readonly type: 'integration.on_error_failed' | 'integration.adapter_misconfigured';
}

/**
 * Existing verifiers exclude every verifier configuration property.
 */
export type IntegrationOptions<TIdentity = VerifiedClaims> = GuardPolicy &
  (
    | (JwtVerifierOptions<TIdentity> & { readonly verifier?: never })
    | ({
        readonly verifier: JwtVerifier<TIdentity>;
      } & { readonly [K in keyof JwtVerifierOptions<TIdentity>]?: never })
  );

/**
 * Safe HTTP response emitted for a rejected guard decision.
 */
export type HttpResponseSpec = HttpError;

/**
 * Next action; skip has no auth and optional continuation carries null for missing credentials.
 */
export type Decision<TIdentity, TMode extends 'required' | 'optional' = 'required'> =
  | { readonly kind: 'skip' }
  | {
      readonly kind: 'continue';
      readonly auth: TMode extends 'required' ? Auth<TIdentity> : Auth<TIdentity> | null;
    }
  | { readonly kind: 'reject'; readonly error: JwtVerifierError; readonly http: HttpResponseSpec };

/**
 * Shared guard with one verifier and no downstream-handler catch boundary.
 */
export interface Guard<TIdentity, TMode extends 'required' | 'optional' = 'required'> {
  /**
   * Decides authentication without executing application code; caller abort is local to this call.
   */
  readonly decide: (
    request: RequestInfoLike,
    signal?: AbortSignal,
  ) => Promise<Decision<TIdentity, TMode>>;

  /**
   * Verifier constructed once or supplied by the integration author.
   */
  readonly verifier: JwtVerifier<TIdentity>;

  /**
   * Reports an unusable onError result without allowing observer failures to escape.
   */
  readonly reportErrorHookFailure: () => void;

  /**
   * Reports a fixed configuration failure without exposing platform data or thrown values.
   */
  readonly reportMisconfiguration: () => void;
}

/**
 * Snapshots and validates policy before creating exactly one verifier; no preflight skips exist.
 */
export function createGuard<
  TIdentity = VerifiedClaims,
  TMode extends 'required' | 'optional' = 'required',
>(options: IntegrationOptions<TIdentity> & { readonly mode?: TMode }): Guard<TIdentity, TMode> {
  if (!options || typeof options !== 'object') {
    throw new ConfigurationError('invalid_options');
  }

  const { mode = 'required', scopeMode = 'all', skip, onIntegrationDiagnostic } = options;
  if (
    !['required', 'optional'].includes(mode) ||
    !['all', 'any'].includes(scopeMode) ||
    (skip !== undefined && typeof skip !== 'function') ||
    (onIntegrationDiagnostic !== undefined && typeof onIntegrationDiagnostic !== 'function')
  ) {
    throw new ConfigurationError('invalid_guard_policy');
  }

  if (options.scopes !== undefined) {
    validateScopes(options.scopes, scopeMode);
  }

  const scopes = options.scopes === undefined ? undefined : [...options.scopes];
  const configurationKeys: ReadonlyArray<keyof JwtVerifierOptions<unknown>> = [
    'issuer',
    'audience',
    'algorithms',
    'jwksUri',
    'discovery',
    'profile',
    'requireExp',
    'verifyTimeout',
    'requiredClaims',
    'clockTolerance',
    'maxTokenAge',
    'maxTokenLength',
    'minRsaModulusLength',
    'keys',
    'shareInflight',
    'allowInsecureLocalhost',
    'realm',
    'fetch',
    'mapClaims',
    'onDiagnostic',
    'clock',
  ];
  if (
    'verifier' in options &&
    (configurationKeys.some((key) => key in options) ||
      !options.verifier ||
      typeof options.verifier.verify !== 'function' ||
      typeof options.verifier.warmup !== 'function' ||
      typeof options.verifier.issuer !== 'string' ||
      !Array.isArray(options.verifier.audience))
  ) {
    throw new ConfigurationError('conflicting_verifier_options');
  }

  const verifier = options.verifier ?? createJwtVerifier(options as JwtVerifierOptions<TIdentity>);
  const realm = 'realm' in options ? options.realm : undefined;
  /**
   * Delivers frozen fixed-vocabulary integration events without exposing caller failures.
   */
  const report = (type: IntegrationDiagnostic['type']): void => {
    try {
      void Promise.resolve(onIntegrationDiagnostic?.(Object.freeze({ type }))).catch(() => {});
    } catch {
      // Observability must never affect authentication or response fallback.
    }
  };
  return Object.freeze({
    verifier,
    reportErrorHookFailure: (): void => report('integration.on_error_failed'),
    reportMisconfiguration: (): void => report('integration.adapter_misconfigured'),
    decide: async (
      request: RequestInfoLike,
      signal?: AbortSignal,
    ): Promise<Decision<TIdentity, TMode>> => {
      const deadline = new Deadline(60, signal);
      try {
        if (deadline.signal.aborted) {
          throw deadline.signal.reason;
        }

        if (skip) {
          const skipped: unknown = skip(request);
          if (typeof skipped !== 'boolean') {
            // Observe malformed async predicates without waiting for them or granting access.
            void Promise.resolve(skipped).catch(() => {});
            throw new JwtVerifierError('adapter_misconfigured');
          }

          if (skipped) {
            return { kind: 'skip' };
          }
        }

        const bearer = getBearerToken(request.authorization);
        if (!bearer.ok) {
          if (bearer.reason === 'missing_token' && mode === 'optional') {
            return { kind: 'continue', auth: null } as Decision<TIdentity, TMode>;
          }

          throw new JwtVerifierError(bearer.reason, realm === undefined ? {} : { realm });
        }

        const auth = await deadline.race(verifier.verify(bearer.token, signal ? { signal } : {}));
        if (scopes) {
          requireScopes(auth, scopes, scopeMode);
        }

        return { kind: 'continue', auth };
      } catch (cause) {
        const error = adapterError(cause);
        return { kind: 'reject', error, http: error.toHttp() };
      } finally {
        deadline.close();
      }
    },
  });
}

/**
 * Structural Node request preserving transport-level authorization multiplicity.
 */
export interface NodeRequestLike {
  /**
   * Distinct values from modern Node, preferred when available.
   */
  readonly headersDistinct?: Readonly<Record<string, ReadonlyArray<string> | undefined>>;

  /**
   * Alternating header names and values, used when distinct headers are unavailable.
   */
  readonly rawHeaders?: ReadonlyArray<string>;
}

/**
 * Structural Lambda header containers, without framework or Node imports.
 */
export interface LambdaEventLike {
  /**
   * Single values, sometimes already comma-joined by ingress.
   */
  readonly headers?: Readonly<Record<string, string | undefined>> | null;

  /**
   * Distinct values supplied by API Gateway v1 or ALB multi-value mode.
   */
  readonly multiValueHeaders?: Readonly<Record<string, ReadonlyArray<string> | undefined>> | null;
}

/**
 * Collects Fetch values; Headers preserves duplicate credentials through comma joining.
 */
export function authorizationFromHeaders(headers: Headers): ReadonlyArray<string> {
  const value = headers.get('authorization');
  return value === null ? [] : [value];
}

/**
 * Collects all case-insensitive authorization entries without reading normalized Node headers.
 */
export function authorizationFromNodeRequest(request: NodeRequestLike): ReadonlyArray<string> {
  if (request.headersDistinct) {
    return Object.entries(request.headersDistinct).flatMap(([name, values]) =>
      name.toLowerCase() === 'authorization' ? (values ?? []) : [],
    );
  }

  const values: string[] = [];
  const raw = request.rawHeaders ?? [];
  for (let index = 0; index < raw.length; index += 2) {
    if (raw[index]?.toLowerCase() === 'authorization') {
      values.push(raw[index + 1] ?? '');
    }
  }

  return values;
}

/**
 * Applies each ingress's duplicate policy; ALB multi-value mode fails closed when misconfigured.
 */
export function authorizationFromLambdaEvent(
  event: LambdaEventLike,
  shape: 'apiGatewayV1' | 'apiGatewayV2' | 'albMultiValue' | 'albSingleValue',
): ReadonlyArray<string> {
  if (shape === 'albMultiValue' && !event.multiValueHeaders) {
    throw new JwtVerifierError('adapter_misconfigured');
  }

  if ((shape === 'apiGatewayV1' || shape === 'albMultiValue') && event.multiValueHeaders) {
    return Object.entries(event.multiValueHeaders).flatMap(([name, values]) =>
      name.toLowerCase() === 'authorization' ? (values ?? []) : [],
    );
  }

  return Object.entries(event.headers ?? {}).flatMap(([name, value]) =>
    name.toLowerCase() === 'authorization' && value !== undefined ? [value] : [],
  );
}

/**
 * Serializes only the safe HTTP body and headers already supplied by the guard.
 */
export function toResponse(spec: HttpResponseSpec): Response {
  return new Response(JSON.stringify(spec.body), { status: spec.status, headers: spec.headers });
}
