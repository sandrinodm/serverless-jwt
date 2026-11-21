/**
 * Fixed, non-reflective descriptions for every verification failure.
 */
export const messages: Readonly<Record<ErrorReason, string>> = Object.freeze({
  missing_token: 'A bearer token is required.',
  malformed_header: 'The authorization header is malformed.',
  multiple_credentials: 'Multiple credentials are not allowed.',
  token_too_large: 'The token exceeds the size limit.',
  malformed_token: 'The token is malformed.',
  unsupported_algorithm: 'The signing algorithm is not allowed.',
  signature_invalid: 'The token signature is invalid.',
  key_not_found: 'No matching signing key was found.',
  token_expired: 'The token has expired.',
  token_not_yet_valid: 'The token is not yet valid.',
  token_issued_in_future: 'The token was issued in the future.',
  token_too_old: 'The token is too old.',
  claim_issuer: 'The token issuer is invalid.',
  claim_audience: 'The token audience is invalid.',
  claim_type: 'A token claim has an invalid type.',
  claim_missing: 'A required token claim is missing.',
  insufficient_scope: 'The token has insufficient scope.',
  discovery_unavailable: 'Issuer discovery is unavailable.',
  discovery_invalid: 'Issuer discovery is invalid.',
  jwks_unavailable: 'Signing keys are unavailable.',
  jwks_invalid: 'The signing key set is invalid.',
  deadline_exceeded: 'The verification deadline was exceeded.',
  request_aborted: 'The verification request was aborted.',
  mapping_failed: 'Claim mapping failed.',
  auth_context_missing: 'Authentication context is missing.',
  adapter_misconfigured: 'The authentication adapter is misconfigured.',
});

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
  readonly body: { readonly error: ErrorCode; readonly error_description: string };
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
 * Maps a fixed internal reason to its public OAuth code.
 */
function codeFor(reason: ErrorReason): ErrorCode {
  if (reason === 'missing_token' || reason === 'insufficient_scope') {
    return reason;
  }

  if (reason === 'malformed_header' || reason === 'multiple_credentials') {
    return 'invalid_request';
  }

  if (['mapping_failed', 'auth_context_missing', 'adapter_misconfigured'].includes(reason)) {
    return 'server_error';
  }

  if (
    [
      'discovery_unavailable',
      'discovery_invalid',
      'jwks_unavailable',
      'jwks_invalid',
      'deadline_exceeded',
      'request_aborted',
    ].includes(reason)
  ) {
    return 'temporarily_unavailable';
  }

  return 'invalid_token';
}

/**
 * Escapes trusted challenge text and rejects control characters at this public boundary too.
 */
export function quoteChallenge(value: string): string {
  if (typeof value !== 'string' || /[^\x20-\x7e]/.test(value)) {
    throw new ConfigurationError('invalid_realm');
  }

  return value.replace(/["\\]/g, '\\$&');
}

/**
 * Every rejected verification uses this fixed-message, explicitly serialized error.
 */
export class JwtVerifierError extends Error {
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
   * Private trusted response options.
   */
  readonly #options: ErrorOptions;

  /**
   * Creates a fixed-message error while retaining its cause privately.
   */
  constructor(reason: ErrorReason, options: ErrorOptions = {}) {
    super(messages[reason], { cause: options.cause });
    this.name = 'JwtVerifierError';
    this.reason = reason;
    this.code = codeFor(reason);
    this.status = {
      missing_token: 401,
      invalid_request: 400,
      invalid_token: 401,
      insufficient_scope: 403,
      temporarily_unavailable: 503,
      server_error: 500,
    }[this.code];
    quoteChallenge(options.realm ?? 'api');
    this.#options = { ...options, ...(options.scopes ? { scopes: [...options.scopes] } : {}) };
  }

  /**
   * Serializes only fixed public fields, never cause or arbitrary thrown values.
   */
  toJSON(): HttpError['body'] {
    return { error: this.code, error_description: this.message };
  }

  /**
   * Produces the sole safe HTTP representation consumed by integrations.
   */
  toHttp(): HttpError {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    };
    if (this.code === 'missing_token') {
      headers['www-authenticate'] =
        `Bearer realm="${quoteChallenge(this.#options.realm ?? 'api')}"`;
    } else if (this.code === 'invalid_request') {
      headers['www-authenticate'] = 'Bearer error="invalid_request"';
    } else if (this.code === 'invalid_token') {
      headers['www-authenticate'] =
        `Bearer error="invalid_token", error_description="${this.message}"`;
    } else if (this.code === 'insufficient_scope') {
      const scopes = this.#options.scopes ?? [];
      if (scopes.some((scope) => !/^[\x21\x23-\x5b\x5d-\x7e]+$/.test(scope))) {
        throw new ConfigurationError('invalid_scopes');
      }

      headers['www-authenticate'] =
        `Bearer error="insufficient_scope", scope="${scopes.join(' ')}"`;
    } else if (this.code === 'temporarily_unavailable') {
      const delay = this.#options.retryAfter;
      headers['retry-after'] = String(
        typeof delay === 'number' && Number.isFinite(delay)
          ? Math.max(1, Math.min(30, Math.ceil(delay)))
          : 1,
      );
    }

    return { status: this.status, headers, body: this.toJSON() };
  }
}

/**
 * Signals a trusted application configuration problem with a stable reason.
 */
export class ConfigurationError extends Error {
  /**
   * Safe configuration discriminator.
   */
  readonly reason: string;

  /**
   * Creates a configuration error without echoing the invalid option value.
   */
  constructor(reason: string) {
    super(
      reason === 'invalid_algorithms'
        ? 'Only asymmetric signing algorithms are supported; symmetric HS algorithms and none are forbidden.'
        : 'Invalid verifier configuration.',
    );
    this.name = 'ConfigurationError';
    this.reason = reason;
  }
}
