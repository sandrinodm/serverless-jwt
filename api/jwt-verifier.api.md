# @serverless-jwt/jwt-verifier

Generated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.

## index.d.mts

```ts
import { BearerResult, getBearerToken } from './bearer.mjs';
import { VerifiedClaims, claimToArray, removeNamespaces } from './claims.mjs';
import { Clock } from './clock.mjs';
import { Diagnostic } from './diagnostics.mjs';
import {
  ConfigurationError,
  ErrorCode,
  ErrorOptions,
  ErrorReason,
  HttpError,
  JwtVerifierError,
} from './errors.mjs';
import { Algorithm, JwtVerifierOptions, KeyOptions } from './options.mjs';
import { hasScopes, requireScopes } from './scopes.mjs';
import { Auth, JwtVerifier, VerifyCallOptions, createJwtVerifier } from './verify.mjs';
export {
  type Algorithm,
  type Auth,
  type BearerResult,
  type Clock,
  ConfigurationError,
  type Diagnostic,
  type ErrorCode,
  type ErrorOptions,
  type ErrorReason,
  type HttpError,
  type JwtVerifier,
  JwtVerifierError,
  type JwtVerifierOptions,
  type KeyOptions,
  type VerifiedClaims,
  type VerifyCallOptions,
  claimToArray,
  createJwtVerifier,
  getBearerToken,
  hasScopes,
  removeNamespaces,
  requireScopes,
};
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

## bearer.d.mts

```ts
/**
 * Header extraction result independent of token verification and HTTP adapters.
 */
export type BearerResult =
  | {
      readonly ok: true;
      readonly token: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'missing_token' | 'malformed_header' | 'multiple_credentials';
    };
/**
 * Extracts a single RFC 6750 bearer credential without trimming forbidden controls.
 */
export declare function getBearerToken(
  value: string | ReadonlyArray<string> | null | undefined,
): BearerResult;
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

## scopes.d.mts

```ts
import { Auth } from './verify.mjs';
/**
 * Tests configured scopes against the verified scope set.
 */
export declare function hasScopes(
  auth: Auth<unknown>,
  required: ReadonlyArray<string>,
  mode?: 'all' | 'any',
): boolean;
/**
 * Requires configured scopes and throws a fixed insufficient-scope error on denial.
 */
export declare function requireScopes(
  auth: Auth<unknown>,
  required: ReadonlyArray<string>,
  mode?: 'all' | 'any',
): void;
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
