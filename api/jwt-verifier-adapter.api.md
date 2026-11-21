# @serverless-jwt/jwt-verifier/adapter

Generated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.

## adapter.d.mts

```ts
import { VerifiedClaims } from './claims.mjs';
import { HttpError, JwtVerifierError } from './errors.mjs';
import { JwtVerifierOptions } from './options.mjs';
import { Auth, JwtVerifier } from './verify.mjs';
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
    | (JwtVerifierOptions<TIdentity> & {
        readonly verifier?: never;
      })
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
  | {
      readonly kind: 'skip';
    }
  | {
      readonly kind: 'continue';
      readonly auth: TMode extends 'required' ? Auth<TIdentity> : Auth<TIdentity> | null;
    }
  | {
      readonly kind: 'reject';
      readonly error: JwtVerifierError;
      readonly http: HttpResponseSpec;
    };
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
export declare function createGuard<
  TIdentity = VerifiedClaims,
  TMode extends 'required' | 'optional' = 'required',
>(
  options: IntegrationOptions<TIdentity> & {
    readonly mode?: TMode;
  },
): Guard<TIdentity, TMode>;
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
export declare function authorizationFromHeaders(headers: Headers): ReadonlyArray<string>;
/**
 * Collects all case-insensitive authorization entries without reading normalized Node headers.
 */
export declare function authorizationFromNodeRequest(
  request: NodeRequestLike,
): ReadonlyArray<string>;
/**
 * Applies each ingress's duplicate policy; ALB multi-value mode fails closed when misconfigured.
 */
export declare function authorizationFromLambdaEvent(
  event: LambdaEventLike,
  shape: 'apiGatewayV1' | 'apiGatewayV2' | 'albMultiValue' | 'albSingleValue',
): ReadonlyArray<string>;
/**
 * Serializes only the safe HTTP body and headers already supplied by the guard.
 */
export declare function toResponse(spec: HttpResponseSpec): Response;
```

## claims.d.mts

```ts
/**
 * Verified JSON claims; runtime values are deeply frozen and objects have no prototype.
 */
export type VerifiedClaims = Readonly<Record<string, unknown>>;
/**
 * Converts space-separated strings or string arrays to claims without coercing arbitrary values.
 */
export declare function claimToArray(value: unknown): ReadonlyArray<string>;
/**
 * Removes only a leading namespace and fails closed on ambiguous claim names in either order.
 */
export declare function removeNamespaces(
  claims: VerifiedClaims,
  namespace: string,
): Readonly<Record<string, unknown>>;
```

## errors.d.mts

```ts
/**
 * Safe internal failure discriminator, independent of provider or token text.
 */
export type ErrorReason =
  | 'missing_token'
  | 'malformed_header'
  | 'multiple_credentials'
  | 'token_too_large'
  | 'malformed_token'
  | 'unsupported_algorithm'
  | 'signature_invalid'
  | 'key_not_found'
  | 'token_expired'
  | 'token_not_yet_valid'
  | 'token_issued_in_future'
  | 'token_too_old'
  | 'claim_issuer'
  | 'claim_audience'
  | 'claim_type'
  | 'claim_missing'
  | 'insufficient_scope'
  | 'discovery_unavailable'
  | 'discovery_invalid'
  | 'jwks_unavailable'
  | 'jwks_invalid'
  | 'deadline_exceeded'
  | 'request_aborted'
  | 'mapping_failed'
  | 'auth_context_missing'
  | 'adapter_misconfigured';
/**
 * Public OAuth error vocabulary.
 */
export type ErrorCode =
  | 'missing_token'
  | 'invalid_request'
  | 'invalid_token'
  | 'insufficient_scope'
  | 'temporarily_unavailable'
  | 'server_error';
/**
 * Sanitized response shared by all future integrations.
 */
export interface HttpError {
  /**
   * HTTP response status.
   */
  readonly status: number;
  /**
   * Safe response headers.
   */
  readonly headers: Readonly<Record<string, string>>;
  /**
   * Fixed public response body.
   */
  readonly body: {
    readonly error: ErrorCode;
    readonly error_description: string;
  };
}
/**
 * Trusted serialization options; no token values belong here.
 */
export interface ErrorOptions {
  /**
   * Non-enumerable original failure, excluded from serialization.
   */
  readonly cause?: unknown;
  /**
   * Validated challenge realm.
   */
  readonly realm?: string;
  /**
   * Bounded retry delay in seconds.
   */
  readonly retryAfter?: number;
  /**
   * Configured required scopes for the challenge.
   */
  readonly scopes?: ReadonlyArray<string>;
}
/**
 * Every rejected verification uses this fixed-message, explicitly serialized error.
 */
export declare class JwtVerifierError extends Error {
  #private;
  /**
   * Safe internal reason.
   */
  readonly reason: ErrorReason;
  /**
   * Public OAuth code.
   */
  readonly code: ErrorCode;
  /**
   * HTTP status associated with the public code.
   */
  readonly status: number;
  /**
   * Creates a fixed-message error while retaining its cause privately.
   */
  constructor(reason: ErrorReason, options?: ErrorOptions);
  /**
   * Serializes only fixed public fields, never cause or arbitrary thrown values.
   */
  toJSON(): HttpError['body'];
  /**
   * Produces the sole safe HTTP representation consumed by integrations.
   */
  toHttp(): HttpError;
}
/**
 * Signals a trusted application configuration problem with a stable reason.
 */
export declare class ConfigurationError extends Error {
  /**
   * Safe configuration discriminator.
   */
  readonly reason: string;
  /**
   * Creates a configuration error without echoing the invalid option value.
   */
  constructor(reason: string);
}
```

## options.d.mts

```ts
import { VerifiedClaims } from './claims.mjs';
import { Clock } from './clock.mjs';
import { Diagnostic } from './diagnostics.mjs';
/**
 * Supported asymmetric signature algorithms; symmetric and unsecured tokens are excluded.
 */
export type Algorithm =
  | 'RS256'
  | 'RS384'
  | 'RS512'
  | 'PS256'
  | 'PS384'
  | 'PS512'
  | 'ES256'
  | 'ES384'
  | 'ES512'
  | 'EdDSA'
  | 'Ed25519';
/**
 * Per-verifier key cache and network resource policy, durations in seconds.
 */
export interface KeyOptions {
  /**
   * Fresh cache lifetime.
   */
  readonly cacheMaxAge?: number;
  /**
   * Minimum time between unknown-key refresh attempts.
   */
  readonly cooldown?: number;
  /**
   * Headers and body request deadline.
   */
  readonly timeout?: number;
  /**
   * Maximum decoded response bytes.
   */
  readonly maxResponseBytes?: number;
  /**
   * Maximum advertised key entries.
   */
  readonly maxKeys?: number;
  /**
   * Optional stale-key outage allowance, off by default.
   */
  readonly staleIfError?: number;
  /**
   * Maximum isolated concurrent requests when sharing is unavailable.
   */
  readonly maxConcurrentFetches?: number;
}
/**
 * Verifier trust roots, profile and extension points; copied at construction.
 */
export interface JwtVerifierOptions<TIdentity = VerifiedClaims> {
  /**
   * Exact expected issuer.
   */
  readonly issuer: string;
  /**
   * API audiences accepted by this verifier.
   */
  readonly audience: string | ReadonlyArray<string>;
  /**
   * Explicit signature algorithm allowlist.
   */
  readonly algorithms?: ReadonlyArray<Algorithm>;
  /**
   * Direct signing-key endpoint, disabling discovery.
   */
  readonly jwksUri?: string;
  /**
   * Discovery protocol, or false with a direct endpoint.
   */
  readonly discovery?: 'oidc' | 'oauth' | false;
  /**
   * Generic provider compatibility or RFC 9068 access-token profile.
   */
  readonly profile?: 'generic' | 'rfc9068';
  /**
   * Requires expiration by default; cannot be disabled for RFC 9068.
   */
  readonly requireExp?: boolean;
  /**
   * Total verification deadline in seconds.
   */
  readonly verifyTimeout?: number;
  /**
   * Additional mandatory claim names.
   */
  readonly requiredClaims?: ReadonlyArray<string>;
  /**
   * Clock skew allowance in seconds.
   */
  readonly clockTolerance?: number;
  /**
   * Maximum token age in seconds, requiring issued-at.
   */
  readonly maxTokenAge?: number;
  /**
   * Maximum compact token character count.
   */
  readonly maxTokenLength?: number;
  /**
   * Minimum RSA modulus bit length, at least 2048.
   */
  readonly minRsaModulusLength?: number;
  /**
   * Local key and network policy.
   */
  readonly keys?: KeyOptions;
  /**
   * Override runtime I/O sharing detection.
   */
  readonly shareInflight?: boolean;
  /**
   * Explicitly allows HTTP only for loopback URLs.
   */
  readonly allowInsecureLocalhost?: boolean;
  /**
   * Validated response challenge realm.
   */
  readonly realm?: string;
  /**
   * Trusted custom fetch; receives a signal even when it ignores cancellation.
   */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Maps verified frozen claims to a separate identity object.
   */
  readonly mapClaims?: (claims: VerifiedClaims) => TIdentity | PromiseLike<TIdentity>;
  /**
   * Receives redacted events; throws and rejections are isolated.
   */
  readonly onDiagnostic?: (event: Diagnostic) => unknown;
  /**
   * Injectable wall clock.
   */
  readonly clock?: Clock;
}
```

## verify.d.mts

```ts
import { VerifiedClaims } from './claims.mjs';
import { JwtVerifierOptions } from './options.mjs';
import 'jose';
/**
 * Successful authentication keeps signed claims separate from application mapping output.
 */
export interface Auth<TIdentity = VerifiedClaims> {
  /**
   * Original credential for delegated on-behalf-of calls; never logged by this library.
   */
  readonly token: string;
  /**
   * Immutable verified payload.
   */
  readonly claims: VerifiedClaims;
  /**
   * Application identity or the original claims by default.
   */
  readonly identity: TIdentity;
  /**
   * Frozen scope set derived solely from verified claims.
   */
  readonly scopes: ReadonlyArray<string>;
}
/**
 * Cancellation local to one verification; does not abort a shared key fetch.
 */
export interface VerifyCallOptions {
  /**
   * Caller cancellation signal.
   */
  readonly signal?: AbortSignal;
}
/**
 * Runtime-neutral token verifier with an isolated discovery and key cache.
 */
export interface JwtVerifier<TIdentity = VerifiedClaims> {
  /**
   * Verifies a compact access token and rejects only with JwtVerifierError.
   */
  readonly verify: (token: string, options?: VerifyCallOptions) => Promise<Auth<TIdentity>>;
  /**
   * Fetches discovery and signing keys before the first request.
   */
  readonly warmup: () => Promise<void>;
  /**
   * Exact configured issuer.
   */
  readonly issuer: string;
  /**
   * Owned configured API audiences.
   */
  readonly audience: ReadonlyArray<string>;
}
/**
 * Constructs an immutable verifier without starting I/O; options are read exactly once here.
 */
export declare function createJwtVerifier<TIdentity = VerifiedClaims>(
  input: JwtVerifierOptions<TIdentity>,
): JwtVerifier<TIdentity>;
```

## clock.d.mts

```ts
/**
 * Injectable wall clock used consistently for key lifetimes and NumericDates.
 */
export interface Clock {
  /**
   * Returns Unix time in milliseconds.
   */
  readonly now: () => number;
}
```

## diagnostics.d.mts

```ts
import { ErrorReason } from './errors.mjs';
/**
 * Fixed event vocabulary with no token or claims content.
 */
export type Diagnostic =
  | {
      readonly type: 'verify.rejected';
      readonly reason: ErrorReason;
    }
  | {
      readonly type:
        | 'config.audience_looks_like_client_id'
        | 'claims.scope_and_scp'
        | 'claims.invalid_scope';
    }
  | {
      readonly type: 'jwks.fetch' | 'discovery.fetch';
      readonly url: string;
      readonly status: number;
      readonly durationMs: number;
      readonly keys?: number;
    }
  | {
      readonly type: 'jwks.key_skipped';
      readonly url: string;
      readonly kid?: string;
      readonly problem: 'invalid_key';
    }
  | {
      readonly type: 'jwks.stale_served';
      readonly ageMs: number;
    };
```
