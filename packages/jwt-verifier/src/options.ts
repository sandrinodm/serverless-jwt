import type { VerifiedClaims } from './claims.ts';
import type { Clock } from './clock.ts';
import type { Diagnostic } from './diagnostics.ts';

import { ConfigurationError, quoteChallenge } from './errors.ts';
import { canShareInflight } from './runtime.ts';

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

/**
 * Validated, owned options consumed only by internal modules.
 */
export interface ResolvedOptions<TIdentity = VerifiedClaims> extends Required<
  Omit<
    JwtVerifierOptions<TIdentity>,
    'jwksUri' | 'maxTokenAge' | 'onDiagnostic' | 'keys' | 'audience'
  >
> {
  /**
   * Owned audience array.
   */
  readonly audience: ReadonlyArray<string>;

  /**
   * Optional direct endpoint.
   */
  readonly jwksUri?: string;

  /**
   * Optional age bound.
   */
  readonly maxTokenAge?: number;

  /**
   * Optional observer.
   */
  readonly onDiagnostic?: (event: Diagnostic) => unknown;

  /**
   * Complete immutable key policy.
   */
  readonly keys: Readonly<Required<KeyOptions>>;
}

/**
 * Validates a network trust endpoint without normalizing its exact issuer identity.
 */
export function validEndpoint(value: unknown, allowLocal: boolean): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (allowLocal &&
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}

/**
 * Validates an integer resource bound and returns its resolved value.
 */
function integer(value: unknown, fallback: number, min: number, max: number): number {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < min || result > max) {
    throw new ConfigurationError('invalid_numeric_option');
  }

  return result;
}

/**
 * Validates, copies and freezes every option so later caller mutation cannot change trust policy.
 */
export function validateOptions<TIdentity>(
  options: JwtVerifierOptions<TIdentity>,
): ResolvedOptions<TIdentity> {
  if (!options || typeof options !== 'object') {
    throw new ConfigurationError('invalid_options');
  }

  const {
    issuer,
    audience,
    algorithms = ['RS256'],
    jwksUri,
    discovery = 'oidc',
    profile = 'generic',
    requireExp = true,
    allowInsecureLocalhost = false,
    shareInflight = canShareInflight(),
    realm = 'api',
    fetch: fetcher = globalThis.fetch.bind(globalThis),
    mapClaims,
    onDiagnostic,
    clock,
    verifyTimeout,
    clockTolerance,
    maxTokenAge,
    maxTokenLength,
    minRsaModulusLength,
    requiredClaims = [],
    keys = {},
  } = options;
  if (
    typeof issuer !== 'string' ||
    !issuer ||
    (jwksUri === undefined && !validEndpoint(issuer, allowInsecureLocalhost))
  ) {
    throw new ConfigurationError('invalid_issuer');
  }

  if (
    (jwksUri !== undefined && !validEndpoint(jwksUri, allowInsecureLocalhost)) ||
    !['oidc', 'oauth', false].includes(discovery) ||
    (discovery === false && !jwksUri)
  ) {
    throw new ConfigurationError('invalid_discovery');
  }

  const audiences = typeof audience === 'string' ? [audience] : audience;
  if (
    !Array.isArray(audiences) ||
    !audiences.length ||
    audiences.some((entry: unknown) => typeof entry !== 'string' || !entry)
  ) {
    throw new ConfigurationError('invalid_audience');
  }

  const allowed = [
    'RS256',
    'RS384',
    'RS512',
    'PS256',
    'PS384',
    'PS512',
    'ES256',
    'ES384',
    'ES512',
    'EdDSA',
    'Ed25519',
  ];
  if (
    !Array.isArray(algorithms) ||
    !algorithms.length ||
    algorithms.some((alg) => !allowed.includes(alg))
  ) {
    throw new ConfigurationError('invalid_algorithms');
  }

  if (
    !['generic', 'rfc9068'].includes(profile) ||
    typeof requireExp !== 'boolean' ||
    (profile === 'rfc9068' && !requireExp) ||
    typeof allowInsecureLocalhost !== 'boolean' ||
    typeof shareInflight !== 'boolean'
  ) {
    throw new ConfigurationError('invalid_profile');
  }

  const clockNow = clock?.now;
  if (
    !Array.isArray(requiredClaims) ||
    requiredClaims.some((claim) => typeof claim !== 'string' || !claim) ||
    typeof fetcher !== 'function' ||
    (mapClaims !== undefined && typeof mapClaims !== 'function') ||
    (onDiagnostic !== undefined && typeof onDiagnostic !== 'function') ||
    (clock !== undefined && (!clock || typeof clockNow !== 'function')) ||
    !keys ||
    typeof keys !== 'object'
  ) {
    throw new ConfigurationError('invalid_extension');
  }

  quoteChallenge(realm);
  const now = clockNow ? clockNow.bind(clock) : Date.now;
  const claims = [
    ...requiredClaims,
    'iss',
    'aud',
    ...(requireExp ? ['exp'] : []),
    ...(profile === 'rfc9068' ? ['exp', 'iat', 'sub', 'client_id', 'jti'] : []),
  ];
  return Object.freeze({
    issuer,
    audience: Object.freeze([...audiences]),
    algorithms: Object.freeze([...algorithms]) as ReadonlyArray<Algorithm>,
    ...(jwksUri !== undefined ? { jwksUri } : {}),
    discovery,
    profile,
    requireExp,
    allowInsecureLocalhost,
    shareInflight,
    realm,
    fetch: fetcher,
    mapClaims: mapClaims ?? ((claims: VerifiedClaims): TIdentity => claims as TIdentity),
    ...(onDiagnostic ? { onDiagnostic } : {}),
    clock: Object.freeze({ now }),
    verifyTimeout: integer(verifyTimeout, 10, 1, 60),
    requiredClaims: Object.freeze([...new Set(claims)]),
    clockTolerance: integer(clockTolerance, 5, 0, 300),
    ...(maxTokenAge !== undefined ? { maxTokenAge: integer(maxTokenAge, 1, 1, 31_536_000) } : {}),
    maxTokenLength: integer(maxTokenLength, 8192, 512, 65_536),
    minRsaModulusLength: integer(minRsaModulusLength, 2048, 2048, Number.MAX_SAFE_INTEGER),
    keys: Object.freeze({
      cacheMaxAge: integer(keys.cacheMaxAge, 600, 0, 86400),
      cooldown: integer(keys.cooldown, 30, 0, 86400),
      timeout: integer(keys.timeout, 5, 1, 60),
      maxResponseBytes: integer(keys.maxResponseBytes, 524288, 1, 16_777_216),
      maxKeys: integer(keys.maxKeys, 100, 1, 10_000),
      staleIfError: integer(keys.staleIfError, 0, 0, 86400),
      maxConcurrentFetches: integer(keys.maxConcurrentFetches, 4, 1, 100),
    }),
  });
}

/**
 * Documentation metadata for every supported option; defaults come from actual validation.
 */
export const optionReference: Readonly<Record<string, string>> = /* @__PURE__ */ Object.freeze({
  issuer:
    'Required nonempty exact string. Without jwksUri, an HTTPS URL; HTTP only for explicitly permitted loopback hosts. No credentials or fragment in network endpoints. A direct jwksUri permits a non-URL issuer identifier.',
  audience:
    'Required nonempty string or nonempty array of nonempty strings. Configure the API resource, distinct from ID-token audiences.',
  algorithms:
    'Nonempty array containing only Algorithm values. HS algorithms and none are forbidden.',
  jwksUri:
    'Optional HTTPS endpoint (or explicitly permitted HTTP loopback); no credentials or fragment. Bypasses discovery.',
  discovery: 'oidc, oauth, or false. false requires jwksUri.',
  profile:
    'generic or rfc9068. RFC 9068 requires an access-token typ and exp, iat, sub, client_id and jti; requireExp cannot be false.',
  requireExp:
    'Boolean; false is allowed only with generic. Issuer and audience always remain required.',
  verifyTimeout: 'Integer seconds, 1\u201360; total verification deadline including mapping.',
  requiredClaims:
    'Array of nonempty claim names; adds to issuer, audience and profile requirements.',
  clockTolerance: 'Integer seconds, 0\u2013300.',
  maxTokenAge: 'Optional integer seconds, 1\u201331536000; requires iat.',
  maxTokenLength: 'Integer compact-token character limit, 512\u201365536.',
  minRsaModulusLength:
    'Integer bits, 2048\u2013Number.MAX_SAFE_INTEGER; does not permit weak RSA keys.',
  keys: 'Object containing the key/network policy below.',
  shareInflight:
    'Boolean. Default is detected from runtime I/O ownership. Unsafe sharing is disabled on workerd and Vercel Edge.',
  allowInsecureLocalhost:
    'Boolean; permits HTTP only for localhost, 127.0.0.1 and [::1]. Does not weaken TLS for remote hosts.',
  realm:
    'ASCII printable string; quotes and backslashes are escaped in the challenge. Controls are rejected.',
  fetch:
    'Trusted function implementing fetch; receives a cancellation signal. Custom fetch must respect the trust policy.',
  mapClaims:
    'Optional function from verified claims to an object or promise-like object. Runs within the total deadline; failures become mapping_failed.',
  onDiagnostic:
    'Optional function receiving redacted Diagnostic events. Throws and rejected thenables are isolated.',
  clock:
    'Optional object with now() returning epoch milliseconds. Invalid results fail verification.',
  'keys.cacheMaxAge': 'Integer seconds, 0\u201386400; fresh JWKS lifetime.',
  'keys.cooldown':
    'Integer seconds, 0\u201386400; global per-verifier unknown-key refresh cooldown.',
  'keys.timeout': 'Integer seconds, 1\u201360; response headers and body deadline.',
  'keys.maxResponseBytes': 'Integer decoded bytes, 1\u201316777216.',
  'keys.maxKeys': 'Integer key entries, 1\u201310000.',
  'keys.staleIfError':
    'Integer seconds, 0\u201386400; outage-only stale-key allowance. Zero disables stale use.',
  'keys.maxConcurrentFetches':
    'Integer requests, 1\u2013100; limit when in-flight sharing is disabled.',
});

/**
 * Numeric validation bounds checked against the actual validator by documentation drift tests.
 */
export const optionBounds: Readonly<Record<string, readonly [number, number]>> =
  /* @__PURE__ */ Object.freeze({
    verifyTimeout: [1, 60],
    clockTolerance: [0, 300],
    maxTokenAge: [1, 31536000],
    maxTokenLength: [512, 65536],
    minRsaModulusLength: [2048, 9007199254740991],
    'keys.cacheMaxAge': [0, 86400],
    'keys.cooldown': [0, 86400],
    'keys.timeout': [1, 60],
    'keys.maxResponseBytes': [1, 16777216],
    'keys.maxKeys': [1, 10000],
    'keys.staleIfError': [0, 86400],
    'keys.maxConcurrentFetches': [1, 100],
  });
