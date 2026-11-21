import type { ProtectedHeaderParameters } from 'jose';

import { createLocalJWKSet } from 'jose';

import type { ResolvedOptions } from '../options.ts';

import { boundedFetch } from '../bounded-fetch.ts';
import { emit } from '../diagnostics.ts';
import { JwtVerifierError } from '../errors.ts';
import { FetchBudget, FetchState } from '../fetch-state.ts';
import { importKeySet } from './import.ts';

/**
 * Owned local selector type, retaining jose's duplicate-match enforcement.
 */
type Selector = ReturnType<typeof createLocalJWKSet>;

/**
 * An authoritative JWKS generation; null records a set with no usable keys.
 */
type KeySet = Selector | null;

/**
 * Reports an outage when the issuer has published no usable signing keys.
 */
function requireSelector(keys: KeySet): Selector {
  if (keys === null) {
    throw new JwtVerifierError('jwks_invalid');
  }

  return keys;
}

/**
 * One verifier's key lifecycle, including cooldown, failure backoff and opt-in stale recovery.
 */
export class KeyStore {
  /**
   * Fully owned verifier policy.
   */
  readonly #options: ResolvedOptions<unknown>;

  /**
   * Trusted endpoint for this store; discovery replacement constructs a new store.
   */
  readonly #url: string;

  /**
   * Fetch ownership and cache timestamps.
   */
  readonly #state: FetchState<KeySet>;

  /**
   * Creates a store without process-wide state or trust-policy sharing.
   */
  constructor(
    options: ResolvedOptions<unknown>,
    url: string,
    budget: FetchBudget = new FetchBudget(options),
  ) {
    this.#options = options;
    this.#url = url;
    this.#state = new FetchState(options, 'jwks', budget);
  }

  /**
   * Replaces the entire key set after bounded fetching and per-key validation.
   */
  async #refresh(unknownKey = false): Promise<KeySet> {
    return this.#state.load(async () => {
      const keys = await importKeySet(
        await boundedFetch(this.#options, this.#url, 'jwks'),
        this.#options,
        this.#url,
      );
      return keys.keys.length ? createLocalJWKSet(keys) : null;
    }, unknownKey);
  }

  /**
   * Reports stale use only inside its explicit outage allowance.
   */
  #fallback(): Selector | undefined {
    const state = this.#state;
    const age = this.#options.clock.now() - state.fetchedAt;
    const fresh = age < this.#options.keys.cacheMaxAge * 1000;
    if (
      state.value &&
      (fresh ||
        (this.#options.keys.staleIfError > 0 &&
          age < (this.#options.keys.cacheMaxAge + this.#options.keys.staleIfError) * 1000))
    ) {
      if (!fresh) {
        emit(this.#options.onDiagnostic, { type: 'jwks.stale_served', ageMs: age });
      }

      return state.value;
    }

    return undefined;
  }

  /**
   * Fetches cold or expired keys, applying fail-closed backoff and bounded stale fallback.
   */
  async #current(): Promise<KeySet> {
    const state = this.#state;
    const fresh =
      this.#options.clock.now() < state.fetchedAt + this.#options.keys.cacheMaxAge * 1000;
    if (fresh && state.value) {
      return state.value;
    }

    try {
      return await this.#refresh(fresh);
    } catch (cause) {
      // A fresh empty set uses the normal rotation cooldown to limit recovery attempts.
      if (cause instanceof JwtVerifierError && cause.reason === 'key_not_found') {
        return null;
      }

      const fallback = this.#fallback();
      if (fallback) {
        return fallback;
      }

      throw cause;
    }
  }

  /**
   * Warms the cache without selecting a token-controlled key.
   */
  async warmup(): Promise<void> {
    requireSelector(await this.#current());
  }

  /**
   * Selects only policy-validated keys; unknown kids reserve at most one attempt per cooldown.
   */
  async get(header: ProtectedHeaderParameters): Promise<CryptoKey | Uint8Array> {
    let selector = await this.#current();
    let refreshed = false;
    while (true) {
      const select = requireSelector(selector);
      try {
        return await select(header);
      } catch (cause) {
        if ((cause as { code?: string }).code !== 'ERR_JWKS_NO_MATCHING_KEY') {
          throw new JwtVerifierError('jwks_invalid', { cause });
        }

        // A completed refresh can replace the selector while its asynchronous miss settles.
        // #current established the cache; successful refreshes only replace its value.
        if (this.#state.value !== selector) {
          selector = this.#state.value as KeySet;
          continue;
        }

        if (refreshed) {
          throw new JwtVerifierError('key_not_found', { cause });
        }
      }

      selector = await this.#refresh(true);
      refreshed = true;
    }
  }
}
