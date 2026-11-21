import type { JWTPayload } from 'jose';

import { decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';

import type { VerifiedClaims } from './claims.ts';
import type { ErrorReason } from './errors.ts';
import type { JwtVerifierOptions, ResolvedOptions } from './options.ts';

import { safeClaims } from './claims.ts';
import { Deadline } from './deadline.ts';
import { emit } from './diagnostics.ts';
import { Discovery } from './discovery.ts';
import { JwtVerifierError } from './errors.ts';
import { FetchBudget } from './fetch-state.ts';
import { KeyStore } from './jwks/store.ts';
import { validateOptions } from './options.ts';
import { scopesFromClaims } from './scopes.ts';
import { assertTokenShape } from './token-shape.ts';

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
 * Translates jose's stable error codes without depending on error class identity or messages.
 */
export function joseReason(cause: unknown): ErrorReason {
  const error = cause as { code?: string; claim?: string; reason?: string } | null;
  if (error?.code === 'ERR_JWT_EXPIRED') {
    return error.claim === 'iat' ? 'token_too_old' : 'token_expired';
  }

  if (error?.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
    if (error.reason === 'missing') {
      return 'claim_missing';
    }

    if (error.claim === 'iss') {
      return 'claim_issuer';
    }

    if (error.claim === 'aud') {
      return 'claim_audience';
    }

    if (error.claim === 'iat') {
      return 'token_issued_in_future';
    }

    return error.claim === 'nbf' ? 'token_not_yet_valid' : 'claim_type';
  }

  if (error?.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
    return 'signature_invalid';
  }

  return 'malformed_token';
}

/**
 * Rejects malformed NumericDates before jose can classify extreme values as ordinary expiry.
 */
function checkNumericDates(payload: JWTPayload): void {
  for (const name of ['exp', 'nbf', 'iat'] as const) {
    const value = payload[name];
    if (
      value !== undefined &&
      (typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        Math.abs(value) > Number.MAX_SAFE_INTEGER / 1000)
    ) {
      throw new JwtVerifierError('malformed_token');
    }
  }
}

/**
 * Enforces RFC 9068 claim types independently of temporal and signature validation.
 */
export function checkProfileClaims(payload: JWTPayload): void {
  if (
    ['sub', 'client_id', 'jti'].some(
      (name) => typeof payload[name] !== 'string' || payload[name].length === 0,
    ) ||
    !(typeof payload.aud === 'string'
      ? payload.aud.length > 0
      : Array.isArray(payload.aud) &&
        payload.aud.length > 0 &&
        payload.aud.every((aud) => typeof aud === 'string' && aud.length > 0))
  ) {
    throw new JwtVerifierError('claim_type');
  }
}

/**
 * Resolves keys with explicit per-verifier state; an endpoint change replaces the entire store.
 */
async function resolveKeys(
  options: ResolvedOptions<unknown>,
  discovery: Discovery,
  state: { readonly budget: FetchBudget; store?: KeyStore; url?: string },
  deadline: Deadline,
): Promise<KeyStore> {
  const url = options.jwksUri ?? (await deadline.race(discovery.get()));
  return selectKeys(options, state, url);
}

/**
 * Replaces endpoint state synchronously before any key I/O begins.
 */
function selectKeys(
  options: ResolvedOptions<unknown>,
  state: { readonly budget: FetchBudget; store?: KeyStore; url?: string },
  url: string,
): KeyStore {
  if (!state.store || state.url !== url) {
    state.store = new KeyStore(options, url, state.budget);
    state.url = url;
  }

  return state.store;
}

/**
 * Constructs an immutable verifier without starting I/O; options are read exactly once here.
 */
export function createJwtVerifier<TIdentity = VerifiedClaims>(
  input: JwtVerifierOptions<TIdentity>,
): JwtVerifier<TIdentity> {
  const options = validateOptions(input);
  const budget = new FetchBudget(options);
  const discovery = new Discovery(options, budget);
  const state: { readonly budget: FetchBudget; store?: KeyStore; url?: string } = { budget };
  let audienceWarned = false;
  return Object.freeze({
    issuer: options.issuer,
    audience: options.audience,
    warmup: async (): Promise<void> => {
      const deadline = new Deadline(options.verifyTimeout);
      try {
        await deadline.race((await resolveKeys(options, discovery, state, deadline)).warmup());
      } catch (cause) {
        throw cause instanceof JwtVerifierError
          ? cause
          : new JwtVerifierError('jwks_unavailable', { cause });
      } finally {
        deadline.close();
      }
    },
    verify: async (token: string, call: VerifyCallOptions = {}): Promise<Auth<TIdentity>> => {
      const deadline = new Deadline(options.verifyTimeout, call.signal);
      try {
        if (deadline.signal.aborted) {
          throw deadline.signal.reason;
        }

        assertTokenShape(token, options.maxTokenLength);
        const header = decodeProtectedHeader(token);
        if (!options.algorithms.includes(header.alg as never)) {
          throw new JwtVerifierError('unsupported_algorithm');
        }

        if (header.crit !== undefined && (!Array.isArray(header.crit) || header.crit.length > 0)) {
          throw new JwtVerifierError('malformed_token');
        }

        if (
          options.profile === 'rfc9068' &&
          (typeof header.typ !== 'string' || !/^(application\/)?at\+jwt$/i.test(header.typ))
        ) {
          throw new JwtVerifierError('claim_type');
        }

        checkNumericDates(decodeJwt(token));
        const key = await deadline.race(
          (await resolveKeys(options, discovery, state, deadline)).get(header),
        );
        const result = await deadline.race(
          jwtVerify(token, key, {
            algorithms: [...options.algorithms],
            issuer: options.issuer,
            audience: [...options.audience],
            clockTolerance: options.clockTolerance,
            ...(options.maxTokenAge !== undefined ? { maxTokenAge: options.maxTokenAge } : {}),
            requiredClaims: [...options.requiredClaims],
            currentDate: new Date(options.clock.now()),
          }),
        );
        const payload = result.payload;
        if (
          payload.iat !== undefined &&
          payload.iat > options.clock.now() / 1000 + options.clockTolerance
        ) {
          throw new JwtVerifierError('token_issued_in_future');
        }

        if (options.profile === 'rfc9068') {
          checkProfileClaims(payload);
        }

        const segment = token.split('.')[1] as string;
        const bytes = Uint8Array.from(
          atob(segment.replace(/-/g, '+').replace(/_/g, '/')),
          (character) => character.charCodeAt(0),
        );
        const claims = safeClaims(new TextDecoder().decode(bytes));
        const scopes = scopesFromClaims(claims, options.onDiagnostic);
        if (
          !audienceWarned &&
          options.profile === 'generic' &&
          options.audience.some(
            (audience) => claims.azp === audience || claims.client_id === audience,
          )
        ) {
          audienceWarned = true;
          emit(options.onDiagnostic, { type: 'config.audience_looks_like_client_id' });
        }

        let identity: TIdentity;
        try {
          identity = await deadline.race(options.mapClaims(claims));
          if (identity === null || typeof identity !== 'object') {
            throw new JwtVerifierError('mapping_failed');
          }
        } catch (cause) {
          throw cause instanceof JwtVerifierError &&
            ['deadline_exceeded', 'request_aborted'].includes(cause.reason)
            ? cause
            : new JwtVerifierError('mapping_failed', { cause });
        }

        return Object.freeze({ token, claims, identity, scopes });
      } catch (cause) {
        const error =
          cause instanceof JwtVerifierError
            ? cause
            : new JwtVerifierError(joseReason(cause), { cause, realm: options.realm });
        emit(options.onDiagnostic, { type: 'verify.rejected', reason: error.reason });
        throw error;
      } finally {
        deadline.close();
      }
    },
  });
}
